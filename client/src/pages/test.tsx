import { useState, useEffect, useCallback, useRef } from "react";
import { TEST_VERSION } from "@shared/constants";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, Shield } from "lucide-react";
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
  },
};

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [language, setLanguage] = useState<"en" | "es">("en");
  const containerRef = useRef<HTMLDivElement>(null);

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
      setIsLoading(false);
      delete (window as any).__initialTestData;
    }
  }, [sessionId]);

  const handleSubmitAnswer = useCallback(async () => {
    if (selectedAnswer === null || !currentQuestion || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/answer`, {
        questionId: currentQuestion.id,
        selectedAnswer,
      });
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
  }, [selectedAnswer, currentQuestion, sessionId, isSubmitting, setLocation, toast, t]);

  const domainLabel = (domain: string) =>
    domain.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const progressPercent = progress
    ? Math.min((progress.questionsAnswered / 50) * 100, 100)
    : 0;

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

      {/* Warning overlay */}
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

              {/* Submit button */}
              <div className="pt-2">
                <Button
                  data-testid="button-submit-answer"
                  onClick={handleSubmitAnswer}
                  disabled={selectedAnswer === null || isSubmitting}
                  className="w-full bg-[#00944F] hover:bg-[#007a41] text-white font-semibold h-12 disabled:opacity-40 uppercase tracking-wide"
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
