import { Check } from "lucide-react";
import { wizardSteps } from "@/lib/trips/options";
import { cn } from "@/lib/utils";

export function TripWizardProgress({ currentStep }: { currentStep: number }) {
  return (
    <div className="mb-6 md:mb-8" aria-label="Trip creation progress">
      <p className="type-small mb-2 font-medium" role="status" aria-live="polite" aria-atomic="true">
        Step {currentStep + 1} of {wizardSteps.length}<span className="md:sr-only"> · {wizardSteps[currentStep].label}</span>
      </p>
      <div role="progressbar" aria-label="Wizard progress" aria-valuemin={0} aria-valuemax={wizardSteps.length}
        aria-valuenow={currentStep + 1} aria-valuetext={`Step ${currentStep + 1} of ${wizardSteps.length}: ${wizardSteps[currentStep].label}`}
        className="h-1 overflow-hidden rounded-full bg-border md:hidden">
        <div className="h-full rounded-full bg-nomvira-orange transition-[width] motion-reduce:transition-none" style={{ width: `${((currentStep + 1) / wizardSteps.length) * 100}%` }} />
      </div>
      <ol className="hidden grid-cols-7 gap-2 md:grid">
        {wizardSteps.map((step, index) => (
          <li key={step.label} aria-current={index === currentStep ? "step" : undefined}
            className={cn("type-meta flex min-w-0 flex-col gap-2 border-t-2 pt-3 text-muted-foreground", index <= currentStep ? "border-nomvira-orange" : "border-border", index === currentStep && "font-medium text-foreground")}>
            <span className="flex items-center gap-1.5">
              {index < currentStep ? <Check className="size-3.5 text-accent-foreground" aria-hidden="true" /> : <span className="tabular-nums">{index + 1}.</span>}
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
