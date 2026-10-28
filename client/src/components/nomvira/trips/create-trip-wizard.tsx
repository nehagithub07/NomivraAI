"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormProvider, useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { createTrip } from "@/lib/trips/actions";
import { todayInTimeZone } from "@/lib/trips/dates";
import { wizardSteps } from "@/lib/trips/options";
import { createTripFormSchema, defaultTripValues, type TripField, type TripFormValues } from "@/lib/trips/validation";
import { TripWizardProgress } from "./trip-wizard-progress";
import { WizardNavigation } from "./wizard-navigation";
import { DestinationStep } from "./steps/destination-step";
import { DatesStep } from "./steps/dates-step";
import { TravelersStep } from "./steps/travelers-step";
import { BudgetStep } from "./steps/budget-step";
import { InterestsStep } from "./steps/interests-step";
import { PreferencesStep } from "./steps/preferences-step";
import { ReviewStep } from "./steps/review-step";

function subscribeCalendar(notify: () => void) {
  const timer = window.setInterval(notify, 60_000);
  window.addEventListener("focus", notify);
  return () => { window.clearInterval(timer); window.removeEventListener("focus", notify); };
}
function browserCalendar() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return `${todayInTimeZone(timeZone)}|${timeZone}`;
}

export function CreateTripWizard({ initialDestination, initialToday }: { initialDestination: string; initialToday: string }) {
  const router = useRouter();
  const calendar = useSyncExternalStore(subscribeCalendar, browserCalendar, () => `${initialToday}|UTC`);
  const [today, timeZone] = calendar.split("|");
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [serverMessage, setServerMessage] = useState<string>();
  const [sessionExpired, setSessionExpired] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const navigationLock = useRef(false);
  const submissionLock = useRef(false);
  const methods = useForm<TripFormValues>({
    defaultValues: { ...defaultTripValues, destination: initialDestination },
    resolver: zodResolver(createTripFormSchema(today)), shouldUnregister: false,
    mode: "onSubmit", reValidateMode: "onChange",
  });
  const { trigger, setFocus, getFieldState, setError, formState: { isSubmitting } } = methods;
  const busy = isSubmitting || navigating;

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start", behavior: "auto" });
    const invalid = wizardSteps[step].fields.find((field) => getFieldState(field).error);
    if (invalid) setFocus(invalid);
  }, [step, getFieldState, setFocus]);

  async function continueStep() {
    if (navigationLock.current || busy) return;
    navigationLock.current = true;
    try {
      if (await trigger([...wizardSteps[step].fields], { shouldFocus: true })) {
        setStep(editing ? 6 : Math.min(6, step + 1)); setEditing(false);
      }
    } finally { navigationLock.current = false; }
  }

  function showInvalidStep(errors: FieldErrors<TripFormValues>) {
    const first = wizardSteps.findIndex((entry) => entry.fields.some((field) => errors[field]));
    if (first >= 0) { setStep(first); setEditing(true); }
  }

  async function submit(values: TripFormValues) {
    if (submissionLock.current) return;
    submissionLock.current = true; setServerMessage(undefined); setSessionExpired(false);
    try {
      const result = await createTrip(values, { timeZone });
      if (result.status === "success") {
        setNavigating(true); router.push(`/trips/${result.tripId}`); return;
      }
      setServerMessage(result.message); setSessionExpired(!!result.sessionExpired);
      if (result.fieldErrors) {
        const invalid: FieldErrors<TripFormValues> = {};
        for (const name of Object.keys(result.fieldErrors) as TripField[]) {
          const message = result.fieldErrors[name]?.[0];
          if (message) { setError(name, { type: "server", message }); invalid[name] = { type: "server", message }; }
        }
        showInvalidStep(invalid);
      }
    } catch {
      setServerMessage("We couldn't create your trip. Your information is still here — please try again.");
    } finally { submissionLock.current = false; }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (step < 6) { event.preventDefault(); void continueStep(); }
    else void methods.handleSubmit(submit, showInvalidStep)(event);
  }

  const current = wizardSteps[step];
  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl">
      <TripWizardProgress currentStep={step} />
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} noValidate aria-label="Create trip" aria-busy={busy}>
          <SurfaceCard size="panel">
            <div className="px-5 pt-6 pb-8 sm:p-8">
              <h2 ref={heading} tabIndex={-1} className="type-section scroll-mt-6 focus:outline-none">{current.heading}</h2>
              <p className="type-body mt-3 max-w-2xl text-muted-foreground">{current.description}</p>
              {serverMessage && <div role="alert" className="type-small mt-5 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-destructive">
                <p>{serverMessage}</p>
                {sessionExpired && <Link href="/login?next=%2Ftrips%2Fnew" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center font-medium underline">Sign in in a new tab</Link>}
              </div>}
              <fieldset disabled={busy} className="mt-7 min-w-0 border-0 p-0">
                <legend className="sr-only">{current.label}</legend>
                {step === 0 && <DestinationStep />}
                {step === 1 && <DatesStep today={today} />}
                {step === 2 && <TravelersStep />}
                {step === 3 && <BudgetStep />}
                {step === 4 && <InterestsStep />}
                {step === 5 && <PreferencesStep />}
                {step === 6 && <ReviewStep onEdit={(target) => { setEditing(true); setStep(target); }} />}
              </fieldset>
            </div>
            <WizardNavigation step={step} busy={busy} editing={editing} onBack={() => {
              if (step === 0) router.push("/trips"); else { setEditing(false); setStep(step - 1); }
            }} />
          </SurfaceCard>
        </form>
      </FormProvider>
      <p className="type-meta mt-4 text-center text-muted-foreground">Your trip is saved when you select Create trip. Refreshing or leaving will clear this form.</p>
    </div>
  );
}
