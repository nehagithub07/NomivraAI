export type TravelVisual = { src: string; alt: string };

export type RecommendedDestination = {
  id: string;
  destination: string;
  country: string;
  reason: string;
  interests: string[];
  isNomviraPick?: boolean;
  visual: TravelVisual;
};

export type RecentTrip = {
  id: string;
  destination: string;
  country: string;
  startDate: string;
  endDate: string;
  days: number;
  status: "Completed";
};

export type DashboardData = {
  user: { firstName: string };
  recommendations: RecommendedDestination[];
  recentTrips: RecentTrip[];
  insight: { title: string; description: string; destination: string };
};

// Presentation fixtures only. No live prices, forecasts, bookings, or personalization.
export const dashboardMock: DashboardData = {
  user: { firstName: "Kartavya" },
  recommendations: [
    {
      id: "kyoto",
      destination: "Kyoto",
      country: "Japan",
      reason: "Quiet temples. Unforgettable little kitchens.",
      interests: ["Culture", "Food"],
      isNomviraPick: true,
      visual: {
        src: "/destinations/kyoto.svg",
        alt: "Illustrated red torii gate surrounded by soft green hills in Kyoto.",
      },
    },
    {
      id: "bali",
      destination: "Bali",
      country: "Indonesia",
      reason: "A slower pace, with a little more green.",
      interests: ["Nature", "Relaxation"],
      visual: {
        src: "/destinations/bali.svg",
        alt: "Illustrated Balinese rice terraces, palms, and a small temple.",
      },
    },
    {
      id: "barcelona",
      destination: "Barcelona",
      country: "Spain",
      reason: "Long lunches and a different kind of skyline.",
      interests: ["Food", "Architecture"],
      visual: {
        src: "/destinations/barcelona.svg",
        alt: "Illustrated Barcelona rooftops and sculptural towers in warm stone tones.",
      },
    },
    {
      id: "rome",
      destination: "Rome",
      country: "Italy",
      reason: "Old stories. Fresh pasta. No wrong turns.",
      interests: ["History", "Food"],
      visual: {
        src: "/destinations/rome.svg",
        alt: "Illustrated Roman bridge, riverside buildings, and umbrella pines.",
      },
    },
  ],
  recentTrips: [
    {
      id: "new-york",
      destination: "New York",
      country: "USA",
      startDate: "2026-05-14",
      endDate: "2026-05-19",
      days: 6,
      status: "Completed",
    },
    {
      id: "miami",
      destination: "Miami",
      country: "USA",
      startDate: "2026-02-07",
      endDate: "2026-02-10",
      days: 4,
      status: "Completed",
    },
  ],
  insight: {
    title: "A little Kyoto, after Tokyo?",
    description:
      "If culture and food are your kind of journey, Kyoto is a lovely next chapter. Think quiet temples, market stops, and time to wander.",
    destination: "Kyoto",
  },
};

// The development empty preset removes the sample history.
export const emptyDashboardMock: DashboardData = {
  ...dashboardMock,
  recentTrips: [],
  insight: {
    ...dashboardMock.insight,
    title: "Could Kyoto be your next chapter?",
  },
};

