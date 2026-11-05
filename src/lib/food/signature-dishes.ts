export const HYDERABAD_DISH_SOURCE = {
  label: "Incredible India — Hyderabad",
  url: "https://www.incredibleindia.gov.in/en/telangana/hyderabad",
} as const;

const hyderabadDishes = [
  "Hyderabadi Biryani",
  "Hyderabadi Haleem",
  "Double ka Meetha",
  "Khubani ka Meetha",
  "Mirchi ka Salan",
] as const;

export function getSignatureDishes(destinationName: string): readonly string[] {
  return getDestinationFoodGuide(destinationName)?.dishes ?? [];
}

type FoodGuide = { city: string; dishes: readonly string[]; source: { label: string; url: string } };
const guides: Record<string, FoodGuide> = {
  hyderabad: { city: "Hyderabad", dishes: hyderabadDishes, source: HYDERABAD_DISH_SOURCE },
  mumbai: { city: "Mumbai", dishes: ["Vada Pav", "Pav Bhaji", "Pani Puri", "Sev Puri"],
    source: { label: "Incredible India — Mumbai", url: "https://www.incredibleindia.gov.in/en/maharashtra/mumbai/a-gastronomic-odyssey" } },
  delhi: { city: "Delhi", dishes: ["Chole Bhature", "Parathas", "Chaat", "Aloo Tikki", "Kebabs"],
    source: { label: "Incredible India — Delhi", url: "https://www.incredibleindia.gov.in/en/delhi/delhi/a-captivating-journey-of-flavours" } },
  jaipur: { city: "Jaipur", dishes: ["Dal Baati Churma", "Ghevar"],
    source: { label: "Incredible India — Jaipur", url: "https://www.incredibleindia.gov.in/en/rajasthan/jaipur" } },
  chennai: { city: "Chennai", dishes: ["Idli", "Dosa", "Parotta", "Chettinad chicken curry"],
    source: { label: "Incredible India — Chennai", url: "https://www.incredibleindia.gov.in/en/tamil-nadu/chennai/a-foodies-guide-to-trying-local" } },
};
const aliases: Record<string, string> = { hyd: "hyderabad", bom: "mumbai", bombay: "mumbai", del: "delhi", "new delhi": "delhi", madras: "chennai" };

export function getDestinationFoodGuide(destinationName: string, country?: string | null): FoodGuide | null {
  if (country && !["india", "in"].includes(country.trim().toLowerCase())) return null;
  const city = destinationName.split(",")[0].trim().toLowerCase();
  return guides[aliases[city] ?? city] ?? null;
}
