import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Globe } from "lucide-react";

const UI_TEXT = {
  en: {
    title: "Canyon State Electric",
    subtitle: "Skills Assessment",
    welcome: "Welcome",
    description: "Enter your name to begin the electrician skills assessment. This adaptive test will evaluate your knowledge across multiple competency areas to determine your skill level.",
    firstName: "First Name",
    lastName: "Last Name",
    firstNamePlaceholder: "Enter your first name",
    lastNamePlaceholder: "Enter your last name",
    startButton: "Begin Assessment",
    starting: "Starting...",
    required: "Required",
    requiredDesc: "Please enter your first and last name.",
    errorTitle: "Error",
    errorDesc: "Failed to start the assessment. Please try again.",
    warning: "This test will enter fullscreen mode. Do not attempt to exit during the test. Your results will be automatically submitted upon completion.",
    footer: "Canyon State Electric — Employee Owned",
    langToggle: "Espa\u00f1ol",
  },
  es: {
    title: "Canyon State Electric",
    subtitle: "Evaluaci\u00f3n de Habilidades",
    welcome: "Bienvenido",
    description: "Ingrese su nombre para comenzar la evaluaci\u00f3n de habilidades el\u00e9ctricas. Esta prueba adaptativa evaluar\u00e1 sus conocimientos en m\u00faltiples \u00e1reas de competencia para determinar su nivel de habilidad.",
    firstName: "Nombre",
    lastName: "Apellido",
    firstNamePlaceholder: "Ingrese su nombre",
    lastNamePlaceholder: "Ingrese su apellido",
    startButton: "Iniciar Evaluaci\u00f3n",
    starting: "Iniciando...",
    required: "Requerido",
    requiredDesc: "Por favor ingrese su nombre y apellido.",
    errorTitle: "Error",
    errorDesc: "No se pudo iniciar la evaluaci\u00f3n. Por favor intente de nuevo.",
    warning: "Esta prueba entrar\u00e1 en modo de pantalla completa. No intente salir durante la prueba. Sus resultados se enviar\u00e1n autom\u00e1ticamente al finalizar.",
    footer: "Canyon State Electric — Empresa de Empleados Propietarios",
    langToggle: "English",
  },
};

export default function LoginPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const t = UI_TEXT[language];

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName.trim() || !lastName.trim()) {
      toast({
        title: t.required,
        description: t.requiredDesc,
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/sessions", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        language,
      });
      const data = await res.json();
      (window as any).__initialTestData = data;
      (window as any).__testLanguage = language;
      setLocation(`/test/${data.sessionId}`);
    } catch (err: any) {
      toast({
        title: t.errorTitle,
        description: t.errorDesc,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0c2340] flex flex-col items-center justify-center p-4">
      {/* Language toggle */}
      <button
        onClick={() => setLanguage(language === "en" ? "es" : "en")}
        className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#133157] border border-[#1e4a7a] text-[#a0b4cc] hover:text-white hover:border-[#136BAC] transition-colors text-sm"
        style={{ fontFamily: 'Montserrat, sans-serif' }}
      >
        <Globe className="w-4 h-4" />
        {t.langToggle}
      </button>

      {/* CSE Logo Area */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border-[3px] border-white bg-white mb-4">
          <span className="text-[#136BAC] font-bold text-2xl tracking-tight" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            CSE
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight uppercase" style={{ fontFamily: 'Montserrat, sans-serif' }}>
          {t.title}
        </h1>
        <p className="text-[#FFCA3A] text-sm mt-1 font-medium tracking-wide uppercase" style={{ fontFamily: 'Montserrat, sans-serif' }}>
          {t.subtitle}
        </p>
      </div>

      <Card className="w-full max-w-md bg-[#133157] border-[#1e4a7a] shadow-2xl">
        <CardContent className="pt-6 pb-6 px-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white mb-1" style={{ fontFamily: 'Montserrat, sans-serif' }}>
              {t.welcome}
            </h2>
            <p className="text-sm text-[#a0b4cc]" style={{ fontFamily: 'Merriweather, serif' }}>
              {t.description}
            </p>
          </div>

          <form onSubmit={handleStart} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="firstName" className="text-[#c8d8e8] text-sm" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                {t.firstName}
              </Label>
              <Input
                id="firstName"
                data-testid="input-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={t.firstNamePlaceholder}
                className="bg-[#0c2340] border-[#1e4a7a] text-white placeholder:text-[#4a6a8a] focus:border-[#136BAC] focus:ring-[#136BAC]"
                style={{ fontFamily: 'Merriweather, serif' }}
                autoFocus
                autoComplete="off"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName" className="text-[#c8d8e8] text-sm" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                {t.lastName}
              </Label>
              <Input
                id="lastName"
                data-testid="input-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={t.lastNamePlaceholder}
                className="bg-[#0c2340] border-[#1e4a7a] text-white placeholder:text-[#4a6a8a] focus:border-[#136BAC] focus:ring-[#136BAC]"
                style={{ fontFamily: 'Merriweather, serif' }}
                autoComplete="off"
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              data-testid="button-start-test"
              className="w-full bg-[#136BAC] hover:bg-[#0e5690] text-white font-semibold h-11 mt-2 uppercase tracking-wide"
              style={{ fontFamily: 'Montserrat, sans-serif' }}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t.starting}
                </>
              ) : (
                t.startButton
              )}
            </Button>
          </form>

          <div className="mt-5 pt-4 border-t border-[#1e4a7a]">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-[#FFCA3A] mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
              </svg>
              <p className="text-xs text-[#a0b4cc]" style={{ fontFamily: 'Merriweather, serif' }}>
                {t.warning}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-[#4a6a8a] text-xs mt-6" style={{ fontFamily: 'Montserrat, sans-serif' }}>
        {t.footer}
      </p>
    </div>
  );
}
