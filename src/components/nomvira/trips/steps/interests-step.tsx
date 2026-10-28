import { Camera, Coffee, Compass, Drama, Landmark, Moon, Mountain, Palette, ShoppingBag, Trees, Utensils, Waves, type LucideIcon } from "lucide-react";
import { tripInterests, optionLabel, type TripInterest } from "@/lib/trips/options";
import { OptionCards } from "../option-cards";

const icons: Record<TripInterest, LucideIcon> = {
  food: Utensils, history: Landmark, culture: Drama, nature: Trees, adventure: Mountain,
  art: Palette, shopping: ShoppingBag, nightlife: Moon, beaches: Waves, relaxation: Coffee,
  photography: Camera, local_experiences: Compass,
};

export function InterestsStep() {
  return <OptionCards name="interests" legend="Interests" hint="Choose 3–5 for the best recommendations. Select at least 1 and up to 8." multiple compact
    options={tripInterests.map((value) => ({ value, label: optionLabel(value), icon: icons[value] }))} />;
}
