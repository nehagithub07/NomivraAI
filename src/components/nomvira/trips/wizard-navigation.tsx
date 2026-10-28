import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WizardNavigation({ step, busy, editing, onBack }: {
  step: number; busy: boolean; editing: boolean; onBack: () => void;
}) {
  return (
    <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-b-2xl border-t bg-card px-5 py-4 sm:px-8 md:bottom-0">
      <Button variant="ghost" onClick={onBack} disabled={busy} className="px-3 sm:px-5">
        <ArrowLeft aria-hidden="true" />Back
      </Button>
      <Button type="submit" loading={busy} className="min-w-0 px-4 sm:px-6">
        {step === 6 ? (busy ? "Creating trip..." : "Create trip") : editing ? "Review trip" : "Continue"}
        {!busy && (step === 6 ? <Check aria-hidden="true" /> : <ArrowRight aria-hidden="true" />)}
      </Button>
    </div>
  );
}
