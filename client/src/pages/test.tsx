import { useState, useEffect, useCallback, useRef } from "react";
import { TEST_VERSION } from "@shared/constants";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, Shield, Clock, SkipForward } from "lucide-react";
import { tryEnterFullscreen, isFullscreenActive, tryReEnterFullscreen, onFullscreenChange } from "@/lib/fullscreen";

interface QuestionData {
  id: number;
  domain: string;
  type: string;
  question: string;
  options: string[];
  imageUrl: string | null;
}

interface ProgressData {
  questionsAnswered: number;
  currentTheta: number;
  estimatedLevel: string;
  isComplete: boolean;
  confidence?: number;
  domainScores?: Record<string, { correct: number; total: number }>;
  correctAnswers?: number;
  totalQuestions?: number;
}

// Time caps (in minutes)
const EARLY_SUBMIT_AVAILABLE_MIN = 30;
const HARD_CAP_MIN = 60;
const WARN_10_MIN = 50;   // 10 minutes remaining → fired at 50:00 elapsed
const WARN_5_MIN = 55;    // 5 minutes remaining
const WARN_1_MIN_SEC = (HARD_CAP_MIN * 60) - 60; // 60 seconds remaining → 59:00 elapsed

const UI_TEXT = {
  en: {
    header: "CSE Skills Assessment",
    question: "Question",
    violations: "violation",
    violationsPlural: "violations",
    warningTitle: "Multiple Violations Detected",
    warningDesc: "You have attempted to leave the test window multiple times. This has been flagged and will be included in your assessment results. Please focus on the test.",
    returnToTest: "Return to Test",
    submitAnswer: "Submit Answer",
    submitting: "Submitting...",
    loading: "Loading question...",
    monitored: "Assessment is timed and monitored",
    footer: "Canyon State Electric",
    tabWarning: "You left the test window. Violation",
    tabWarningEnd: "The test may be terminated.",
    errorTitle: "Error",
    errorDesc: "Failed to submit answer. Please try again.",
    warningLabel: "Warning",
    skipQuestion: "Skip Question",
    skipConfirmTitle: "Skip This Question?",
    skipConfirmDesc: "Skipped questions are marked incorrect and cannot be returned to.",
    skipConfirm: "Yes, Skip",
    cancel: "Cancel",
    turnInTest: "Turn In Test",
    turnInTitle: "Turn In Test Now?",
    turnInDesc: "Your results will be calculated using the questions you have answered so far. Once submitted, you cannot return to the test.",
    turnInConfirm: "Yes, Turn In Test",
    timeWarn10Title: "10 Minutes Remaining",
    timeWarn5Title: "5 Minutes Remaining",
    timeWarn1Title: "1 Minute Remaining",
    timeWarnDesc: "The test will automatically submit when time expires. Answer as many questions as you can.",
    timeUpTitle: "Time's Up",
    timeUpDesc: "The 60-minute time limit has been reached. Your test is being submitted automatically.",
    ok: "OK",
    timeLabel: "Time",
  },
  es: {
    header: "Evaluaci\u00f3n de Habilidades CSE",
    question: "Pregunta",
    violations: "violaci\u00f3n",
    violationsPlural: "violaciones",
    warningTitle: "M\u00faltiples Violaciones Detectadas",
    warningDesc: "Ha intentado salir de la ventana de la prueba varias veces. Esto ha sido registrado y se incluir\u00e1 en los resultados de su evaluaci\u00f3n. Por favor conc\u00e9ntrese en la prueba.",
    returnToTest: "Volver a la Prueba",
    submitAnswer: "Enviar Respuesta",
    submitting: "Enviando...",
    loading: "Cargando pregunta...",
    monitored: "La evaluaci\u00f3n es cronometrada y monitoreada",
    footer: "Canyon State Electric",
    tabWarning: "Sali\u00f3 de la ventana de la prueba. Violaci\u00f3n",
    tabWarningEnd: "La prueba puede ser terminada.",
    errorTitle: "Error",
    errorDesc: "No se pudo enviar la respuesta. Por favor intente de nuevo.",
    warningLabel: "Advertencia",
    skipQuestion: "Saltar Pregunta",
    skipConfirmTitle: "\u00bfSaltar Esta Pregunta?",
    skipConfirmDesc: "Las preguntas saltadas se marcan como incorrectas y no se puede regresar a ellas.",
    skipConfirm: "S\u00ed, Saltar",
    cancel: "Cancelar",
    turnInTest: "Entregar Prueba",
    turnInTitle: "\u00bfEntregar la Prueba Ahora?",
    turnInDesc: "Sus resultados se calcular\u00e1n con las preguntas que ha respondido hasta ahora. Una vez enviada, no podr\u00e1 volver a la prueba.",
    turnInConfirm: "S\u00ed, Entregar Prueba",
    timeWarn10Title: "10 Minutos Restantes",
    timeWarn5Title: "5 Minutos Restantes",
    timeWarn1Title: "1 Minuto Restante",
    timeWarnDesc: "La prueba se enviar\u00e1 autom\u00e1ticamente cuando se acabe el tiempo. Responda tantas preguntas como pueda.",
    timeUpTitle: "Tiempo Agotado",
    timeUpDesc: "Se ha alcanzado el l\u00edmite de 60 minutos. Su prueba se est\u00e1 enviando autom\u00e1ticamente.",
    ok: "OK",
    timeLabel: "Tiempo",
  },
};

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function TestPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = parseInt(params.sessionId || "0");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tabViolations, setTabViolations] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [, setIsFullscreen] = useState(false);
  const [language, setLanguage] = useState<"en" | "es">("en");
  const containerRef = useRef<HTMLDivElement>(null);

  // Timer state
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Skip / Turn-in / time-warning modals
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [showTurnInConfirm, setShowTurnInConfirm] = useState(false);
  const [showTimeWarning, setShowTimeWarning] = useState<null | "10" | "5" | "1" | "up">(null);

  // Track which warnings have already fired so we don't repeat them
  const firedWarnings = useRef<Set<string>>(new Set());
  // Guard so the auto-submit only fires once
  const autoSubmittedRef = useRef(false);

  const t = UI_TEXT[language];

  useEffect(() => {
    // Get language from the stored session data
    const stored = (window as any).__testLanguage;
    if (stored === "es") setLanguage("es");
    tryEnterFullscreen().then(() => {
      setIsFullscreen(isFullscreenActive());
    });
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabViolations((prev) => {
          const newCount = prev + 1;
          if (newCount >= 3) {
            setShowWarning(true);
          }
          return newCount;
        });
        toast({
          title: t.warningLabel,
          description: `${t.tabWarning} ${tabViolations + 1}/3. ${t.tabWarningEnd}`,
          variant: "destructive",
        });
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" ||
        (e.altKey && e.key === "Tab") ||
        (e.ctrlKey && e.key === "t") ||
        (e.ctrlKey && e.key === "n") ||
        (e.ctrlKey && e.key === "w") ||
        (e.metaKey && e.key === "Tab") ||
        e.key === "F11" ||
        (e.ctrlKey && e.key === "l") ||
        (e.altKey && e.key === "F4")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleContextMenu = (e: Event) => {
      e.preventDefault();
    };

    const handleFsChange = () => {
      if (!isFullscreenActive()) {
        setIsFullscreen(false);
        tryReEnterFullscreen();
      } else {
        setIsFullscreen(true);
      }
    };

    const cleanupFs = onFullscreenChange(handleFsChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("contextmenu", handleContextMenu);

    return () => {
      cleanupFs();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [tabViolations, toast, t]);

  useEffect(() => {
    const fetchQuestion = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/next`);
        if (res.ok) {
          const data = await res.json();
          setCurrentQuestion(data.nextQuestion);
          setProgress(data.progress);
          if (data.language === "es") setLanguage("es");
          if (data.startedAt) setStartTime(new Date(data.startedAt).getTime());
        }
      } catch {
      }
      setIsLoading(false);
    };
    fetchQuestion();
  }, [sessionId]);

  useEffect(() => {
    const stored = (window as any).__initialTestData;
    if (stored && stored.sessionId === sessionId) {
      setCurrentQuestion(stored.nextQuestion);
      setProgress(stored.progress);
      if (stored.language === "es") setLanguage("es");
      if (stored.startedAt) setStartTime(new Date(stored.startedAt).getTime());
      setIsLoading(false);
      delete (window as any).__initialTestData;
    }
  }, [sessionId]);

  // Tick the elapsed-time clock once per second
  useEffect(() => {
    if (!startTime) return;
    const tick = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startTime]);

  // Submit early (manual 30-min "Turn In" or 60-min auto). Returns boolean success.
  const submitEarly = useCallback(
    async (reason: "manual" | "timeout") => {
      try {
        const res = await apiRequest("POST", `/api/sessions/${sessionId}/submit-early`, { reason });
        const data = await res.json();
        if (data.progress?.isComplete) {
          setProgress(data.progress);
          setLocation(`/results/${sessionId}`);
          return true;
        }
      } catch (err: any) {
        toast({
          title: t.errorTitle,
          description: t.errorDesc,
          variant: "destructive",
        });
      }
      return false;
    },
    [sessionId, setLocation, toast, t]
  );

  // Watch elapsed time and fire warnings / hard cap
  useEffect(() => {
    if (!startTime) return;
    const elapsedMin = elapsedSec / 60;

    if (elapsedMin >= HARD_CAP_MIN && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      setShowTimeWarning("up");
      // Auto-submit after a short delay so user sees the "Time's Up" notice
      window.setTimeout(() => {
        submitEarly("timeout");
      }, 2500);
      return;
    }

    if (elapsedSec >= WARN_1_MIN_SEC && !firedWarnings.current.has("1")) {
      firedWarnings.current.add("1");
      setShowTimeWarning("1");
    } else if (elapsedMin >= WARN_5_MIN && !firedWarnings.current.has("5")) {
      firedWarnings.current.add("5");
      setShowTimeWarning("5");
    } else if (elapsedMin >= WARN_10_MIN && !firedWarnings.current.has("10")) {
      firedWarnings.current.add("10");
      setShowTimeWarning("10");
    }
  }, [elapsedSec, startTime, submitEarly]);

  const handleSubmitAnswer = useCallback(
    async (opts?: { skip?: boolean }) => {
      if (!currentQuestion || isSubmitting) return;
      const isSkip = !!opts?.skip;
      if (!isSkip && selectedAnswer === null) return;

      setIsSubmitting(true);
      try {
        const body = isSkip
          ? { questionId: currentQuestion.id, skipped: true }
          : { questionId: currentQuestion.id, selectedAnswer };
        const res = await apiRequest("POST", `/api/sessions/${sessionId}/answer`, body);
        const data = await res.json();

        if (data.progress?.isComplete) {
          setProgress(data.progress);
          setLocation(`/results/${sessionId}`);
          return;
        }

        setCurrentQuestion(data.nextQuestion);
        setProgress(data.progress);
        setSelectedAnswer(null);
      } catch (err: any) {
        toast({
          title: t.errorTitle,
          description: t.errorDesc,
          variant: "destructive",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectedAnswer, currentQuestion, sessionId, isSubmitting, setLocation, toast, t]
  );

  const domainLabel = (domain: string) =>
    domain.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const progressPercent = progress
    ? Math.min((progress.questionsAnswered / 60) * 100, 100)
    : 0;

  const turnInAvailable = elapsedSec >= EARLY_SUBMIT_AVAILABLE_MIN * 60 && (progress?.questionsAnswered || 0) > 0;
  const elapsedMin = elapsedSec / 60;

  // Color the clock as time runs low
  const clockColorClass =
    elapsedMin >= WARN_5_MIN ? "text-[#ef5350]" : elapsedMin >= WARN_10_MIN ? "text-[#FFCA3A]" : "text-[#c8d8e8]";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0c2340] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#136BAC]" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="min-h-screen bg-[#0c2340] flex flex-col select-none"
      style={{ userSelect: "none", WebkitUserSelect: "none" }}>
      {/* Top bar */}
      <div className="bg-[#133157] border-b border-[#1e4a7a] px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#136BAC]" />
            <span className="text-sm font-medium text-[#c8d8e8] uppercase tracking-wide" style={{ fontFamily: 'Montserrat, sans-serif' }}>
              {t.header}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {/* Elapsed timer (always visible) */}
            <span
              data-testid="elapsed-timer"
              className={`text-xs font-semibold flex items-center gap-1.5 tabular-nums ${clockColorClass}`}
              style={{ fontFamily: 'Montserrat, sans-serif' }}
              title={`${t.timeLabel} elapsed`}
            >
              <Clock className="w-3.5 h-3.5" />
              {formatElapsed(elapsedSec)}
            </span>
            <span className="text-xs text-[#a0b4cc]" style={{ fontFamily: 'Montserrat, sans-serif' }}>
              {t.question} {(progress?.questionsAnswered || 0) + 1}
            </span>
            {tabViolations > 0 && (
              <span className="text-xs text-[#ef5350] flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {tabViolations} {tabViolations > 1 ? t.violationsPlural : t.violations}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-[#133157] px-4 pb-3">
        <div className="max-w-3xl mx-auto">
          <Progress value={progressPercent} className="h-1.5 bg-[#1e4a7a]" />
        </div>
      </div>

      {/* Floating "Turn In Test" button (after 30 minutes) */}
      {turnInAvailable && !showTurnInConfirm && showTimeWarning !== "up" && (
        <button
          data-testid="button-turn-in-test"
          onClick={() => setShowTurnInConfirm(true)}
          className="fixed top-4 right-4 z-30 bg-[#FFCA3A] hover:bg-[#ffb800] text-[#0c2340] font-bold text-xs uppercase tracking-wide px-4 py-2.5 rounded-md shadow-lg border-2 border-[#0c2340]"
          style={{ fontFamily: 'Montserrat, sans-serif' }}
        >
          {t.turnInTest}
        </button>
      )}

      {/* Tab violation warning overlay */}
      {showWarning && (
        <div className="fixed inset-0 bg-red-900/90 z-50 flex items-center justify-center p-4">
          <Card className="bg-[#1a1a2e] border-red-500 max-w-md">
            <CardContent className="pt-6 text-center">
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2 uppercase" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                {t.warningTitle}
              </h2>
              <p className="text-[#a0b4cc] mb-4" style={{ fontFamily: 'Merriweather, serif' }}>
                {t.warningDesc}
              </p>
              <Button
                onClick={() => setShowWarning(false)}
                className="bg-[#136BAC] hover:bg-[#0e5690] uppercase tracking-wide"
                style={{ fontFamily: 'Montserrat, sans-serif' }}
              >
                {t.returnToTest}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Skip confirmation modal */}
      {showSkipConfirm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <Card className="bg-[#0f2d4f] border-[#FFCA3A] max-w-md">
            <CardContent className="pt-6 text-center">
              <SkipForward className="w-10 h-10 text-[#FFCA3A] mx-auto mb-3" />
              <h2 className="text-lg font-bold text-white mb-2 uppercase" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                {t.skipConfirmTitle}
              </h2>
              <p className="text-[#a0b4cc] mb-5 text-sm" style={{ fontFamily: 'Merriweather, serif' }}>
                {t.skipConfirmDesc}
              </p>
              <div className="flex gap-3 justify-center">
                <Button
                  data-testid="button-skip-cancel"
                  onClick={() => setShowSkipConfirm(false)}
                  variant="outline"
                  className="border-[#1e4a7a] bg-transparent text-[#c8d8e8] hover:bg-[#1e4a7a] uppercase tracking-wide"
                  style={{ fontFamily: 'Montserrat, sans-serif' }}
                >
                  {t.cancel}
                </Button>
                <Button
                  data-testid="button-skip-confirm"
                  onClick={() => {
                    setShowSkipConfirm(false);
                    handleSubmitAnswer({ skip: true });
                  }}
                  className="bg-[#FFCA3A] hover:bg-[#ffb800] text-[#0c2340] font-semibold uppercase tracking-wide"
                  style={{ fontFamily: 'Montserrat, sans-serif' }}
                >
                  {t.skipConfirm}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Turn In confirmation modal */}
      {showTurnInConfirm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <Card className="bg-[#0f2d4f] border-[#FFCA3A] max-w-md">
            <CardContent className="pt-6 text-center">
              <Clock className="w-10 h-10 text-[#FFCA3A] mx-auto mb-3" />
              <h2 className="text-lg font-bold text-white mb-2 uppercase" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                {t.turnInTitle}
              </h2>
              <p className="text-[#a0b4cc] mb-5 text-sm" style={{ fontFamily: 'Merriweather, serif' }}>
                {t.turnInDesc}
              </p>
              <div className="flex gap-3 justify-center">
                <Button
                  data-testid="button-turn-in-cancel"
                  onClick={() => setShowTurnInConfirm(false)}
                  variant="outline"
                  className="border-[#1e4a7a] bg-transparent text-[#c8d8e8] hover:bg-[#1e4a7a] uppercase tracking-wide"
                  style={{ fontFamily: 'Montserrat, sans-serif' }}
                >
                  {t.cancel}
                </Button>
                <Button
                  data-testid="button-turn-in-confirm"
                  onClick={() => {
                    setShowTurnInConfirm(false);
                    submitEarly("manual");
                  }}
                  className="bg-[#FFCA3A] hover:bg-[#ffb800] text-[#0c2340] font-semibold uppercase tracking-wide"
                  style={{ fontFamily: 'Montserrat, sans-serif' }}
                >
                  {t.turnInConfirm}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Time warning modals */}
      {showTimeWarning && showTimeWarning !== "up" && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <Card className="bg-[#0f2d4f] border-[#FFCA3A] max-w-md">
            <CardContent className="pt-6 text-center">
              <Clock className="w-12 h-12 text-[#FFCA3A] mx-auto mb-3" />
              <h2 className="text-xl font-bold text-white mb-2 uppercase" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                {showTimeWarning === "10"
                  ? t.timeWarn10Title
                  : showTimeWarning === "5"
                  ? t.timeWarn5Title
                  : t.timeWarn1Title}
              </h2>
              <p className="text-[#a0b4cc] mb-5 text-sm" style={{ fontFamily: 'Merriweather, serif' }}>
                {t.timeWarnDesc}
              </p>
              <Button
                data-testid="button-time-warning-ok"
                onClick={() => setShowTimeWarning(null)}
                className="bg-[#FFCA3A] hover:bg-[#ffb800] text-[#0c2340] font-semibold uppercase tracking-wide"
                style={{ fontFamily: 'Montserrat, sans-serif' }}
              >
                {t.ok}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Time's Up overlay (no dismiss — auto-submitting) */}
      {showTimeWarning === "up" && (
        <div className="fixed inset-0 bg-red-900/90 z-50 flex items-center justify-center p-4">
          <Card className="bg-[#1a1a2e] border-red-500 max-w-md">
            <CardContent className="pt-6 text-center">
              <Clock className="w-14 h-14 text-red-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2 uppercase" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                {t.timeUpTitle}
              </h2>
              <p className="text-[#c8d8e8] text-sm" style={{ fontFamily: 'Merriweather, serif' }}>
                {t.timeUpDesc}
              </p>
              <Loader2 className="h-6 w-6 animate-spin text-[#FFCA3A] mx-auto mt-4" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main test area */}
      <div className="flex-1 flex items-start justify-center p-4 pt-8">
        <div className="w-full max-w-3xl">
          {currentQuestion ? (
            <div className="space-y-6">
              {/* Domain badge */}
              <div>
                <span className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-[#1e4a7a] text-[#82b4e0] uppercase tracking-wide" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                  {domainLabel(currentQuestion.domain)}
                </span>
              </div>

              {/* Question */}
              <div>
                <h2 className="text-lg font-normal text-white leading-relaxed" style={{ fontFamily: 'Merriweather, serif' }}>
                  {currentQuestion.question}
                </h2>
              </div>

              {/* Answer options */}
              <div className="space-y-3">
                {currentQuestion.options.map((option, index) => {
                  const letter = ["A", "B", "C", "D"][index];
                  const isSelected = selectedAnswer === index;

                  return (
                    <button
                      key={index}
                      data-testid={`option-${letter}`}
                      onClick={() => setSelectedAnswer(index)}
                      disabled={isSubmitting}
                      className={`w-full text-left p-4 rounded-lg border-2 transition-all duration-150 flex items-start gap-3 ${
                        isSelected
                          ? "border-[#136BAC] bg-[#136BAC]/10"
                          : "border-[#1e4a7a] bg-[#133157] hover:border-[#2a5a8f] hover:bg-[#183a62]"
                      }`}
                    >
                      <span
                        className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-sm font-semibold ${
                          isSelected
                            ? "bg-[#136BAC] text-white"
                            : "bg-[#1e4a7a] text-[#a0b4cc]"
                        }`}
                        style={{ fontFamily: 'Montserrat, sans-serif' }}
                      >
                        {letter}
                      </span>
                      <span className={`text-sm leading-relaxed ${isSelected ? "text-white" : "text-[#c8d8e8]"}`} style={{ fontFamily: 'Merriweather, serif' }}>
                        {option}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Action buttons: Submit + Skip */}
              <div className="pt-2 flex gap-3">
                <Button
                  data-testid="button-submit-answer"
                  onClick={() => handleSubmitAnswer()}
                  disabled={selectedAnswer === null || isSubmitting}
                  className="flex-1 bg-[#00944F] hover:bg-[#007a41] text-white font-semibold h-12 disabled:opacity-40 uppercase tracking-wide"
                  style={{ fontFamily: 'Montserrat, sans-serif' }}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t.submitting}
                    </>
                  ) : (
                    t.submitAnswer
                  )}
                </Button>
                <Button
                  data-testid="button-skip-question"
                  onClick={() => setShowSkipConfirm(true)}
                  disabled={isSubmitting}
                  variant="outline"
                  className="border-[#1e4a7a] bg-transparent text-[#c8d8e8] hover:bg-[#1e4a7a] hover:text-white font-semibold h-12 px-6 uppercase tracking-wide disabled:opacity-40"
                  style={{ fontFamily: 'Montserrat, sans-serif' }}
                >
                  <SkipForward className="mr-2 h-4 w-4" />
                  {t.skipQuestion}
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#136BAC] mx-auto mb-4" />
              <p className="text-[#a0b4cc]" style={{ fontFamily: 'Merriweather, serif' }}>{t.loading}</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom info bar */}
      <div className="bg-[#133157] border-t border-[#1e4a7a] px-4 py-2">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <span className="text-xs text-[#4a6a8a]" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            {t.monitored}
          </span>
          <span className="text-xs text-[#4a6a8a]" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            v{TEST_VERSION}
          </span>
          <span className="text-xs text-[#4a6a8a]" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            {t.footer}
          </span>
        </div>
      </div>
    </div>
  );
}
