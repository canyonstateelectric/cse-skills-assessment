import { useEffect, useState } from "react";
import { TEST_VERSION } from "@shared/constants";
import { useParams, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, Lock } from "lucide-react";
import { tryExitFullscreen } from "@/lib/fullscreen";
import { apiRequest } from "@/lib/queryClient";

const UI_TEXT = {
  en: {
    title: "Assessment Complete",
    message: "Your results have been submitted to the Canyon State Electric recruitment team. A team member will be with you shortly to review your results.",
    thankYou: "Thank you for completing the Canyon State Electric Skills Assessment.",
    passwordPlaceholder: "Enter administrator password",
    unlockButton: "Unlock",
    unlocking: "Verifying...",
    invalidPassword: "Invalid password. Please try again.",
    footer: "Canyon State Electric — Employee Owned",
  },
  es: {
    title: "Evaluaci\u00f3n Completada",
    message: "Sus resultados han sido enviados al equipo de reclutamiento de Canyon State Electric. Un miembro del equipo estar\u00e1 con usted en breve para revisar sus resultados.",
    thankYou: "Gracias por completar la Evaluaci\u00f3n de Habilidades de Canyon State Electric.",
    passwordPlaceholder: "Ingrese contrase\u00f1a de administrador",
    unlockButton: "Desbloquear",
    unlocking: "Verificando...",
    invalidPassword: "Contrase\u00f1a inv\u00e1lida. Por favor intente de nuevo.",
    footer: "Canyon State Electric — Empresa de Empleados Propietarios",
  },
};

export default function ResultsPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = parseInt(params.sessionId || "0");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [, setLocation] = useLocation();

  // Detect language from the stored session data or default to en
  const [language, setLanguage] = useState<"en" | "es">("en");

  const t = UI_TEXT[language];

  useEffect(() => {
    tryExitFullscreen();

    // Get language from window or fetch session
    const storedLang = (window as any).__testLanguage;
    if (storedLang === "es") {
      setLanguage("es");
    }

    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/results`);
        if (!res.ok) throw new Error("Failed to load results");
        const data = await res.json();
        // Session exists and is complete — that's all we need
        if (data.language === "es") setLanguage("es");
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSession();
  }, [sessionId]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsUnlocking(true);
    setPasswordError(false);
    try {
      const res = await apiRequest("POST", "/api/verify-reset", {
        password: password.trim(),
      });
      const data = await res.json();
      if (data.success) {
        // Clear language state and go back to login
        delete (window as any).__testLanguage;
        delete (window as any).__initialTestData;
        setLocation("/");
      } else {
        setPasswordError(true);
      }
    } catch {
      setPasswordError(true);
    } finally {
      setIsUnlocking(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0c2340] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#136BAC] mx-auto mb-4" />
          <p className="text-[#a0b4cc]" style={{ fontFamily: 'Merriweather, serif' }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0c2340] flex items-center justify-center p-4">
        <Card className="bg-[#133157] border-[#1e4a7a] max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-[#ef5350]" style={{ fontFamily: 'Merriweather, serif' }}>
              {error}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0c2340] flex flex-col items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {/* Completion header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#00944F]/20 mb-6">
            <CheckCircle2 className="w-10 h-10 text-[#00944F]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3 uppercase tracking-wide" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            {t.title}
          </h1>
          <p className="text-[#a0b4cc] text-base leading-relaxed" style={{ fontFamily: 'Merriweather, serif' }}>
            {t.message}
          </p>
        </div>

        {/* Thank you footer text */}
        <p className="text-center text-[#4a6a8a] text-sm mb-10" style={{ fontFamily: 'Merriweather, serif' }}>
          {t.thankYou}
        </p>

        {/* Password unlock section */}
        <Card className="bg-[#133157] border-[#1e4a7a]">
          <CardContent className="pt-5 pb-5">
            <form onSubmit={handleUnlock} className="flex items-center gap-3">
              <Lock className="w-4 h-4 text-[#4a6a8a] flex-shrink-0" />
              <Input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setPasswordError(false); }}
                placeholder={t.passwordPlaceholder}
                className="bg-[#0c2340] border-[#1e4a7a] text-white placeholder:text-[#4a6a8a] focus:border-[#136BAC] focus:ring-[#136BAC] text-sm"
                style={{ fontFamily: 'Merriweather, serif' }}
                autoComplete="off"
                disabled={isUnlocking}
              />
              <Button
                type="submit"
                className="bg-[#1e4a7a] hover:bg-[#2a5a8f] text-white text-sm px-4 flex-shrink-0 uppercase tracking-wide"
                style={{ fontFamily: 'Montserrat, sans-serif' }}
                disabled={isUnlocking || !password.trim()}
              >
                {isUnlocking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t.unlockButton
                )}
              </Button>
            </form>
            {passwordError && (
              <p className="text-[#ef5350] text-xs mt-2 ml-7" style={{ fontFamily: 'Merriweather, serif' }}>
                {t.invalidPassword}
              </p>
            )}
          </CardContent>
        </Card>

        <p className="text-[#4a6a8a] text-xs mt-8 text-center" style={{ fontFamily: 'Montserrat, sans-serif' }}>
          {t.footer}
        </p>
        <p className="text-[#3a5a7a] text-[10px] mt-1 text-center" style={{ fontFamily: 'Montserrat, sans-serif' }}>
          Test Version {TEST_VERSION}
        </p>
      </div>
    </div>
  );
}
