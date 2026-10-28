export type TravelVisual = { src: string; alt: string };

export type UpcomingTrip = {
  id: string;
  destination: string;
  country: string;
  startDate: string;
  endDate: string;
  days: number;
  travelers: number;
  currency: string;
  totalBudget: number;
  budgetUsed: number;
  weatherTemperature: number;
  weatherCondition: string;
  activitiesPlanned: number;
  status: "Planning" | "Upcoming";
  visual: TravelVisual;
};

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
  upcomingTrip: UpcomingTrip | null;
  recommendations: RecommendedDestination[];
  recentTrips: RecentTrip[];
  insight: { title: string; description: string; destination: string };
};

// Presentation fixtures only. No live prices, forecasts, bookings, or personalization.
export const dashboardMock: DashboardData = {
  user: { firstName: "Kartavya" },
  upcomingTrip: {
    id: "tokyo-spring",
    destination: "Tokyo",
    country: "Japan",
    startDate: "2027-04-12",
    endDate: "2027-04-18",
    days: 6,
    travelers: 2,
    currency: "USD",
    totalBudget: 2200,
    budgetUsed: 1280,
    weatherTemperature: 22,
    weatherCondition: "Partly cloudy",
    activitiesPlanned: 14,
    status: "Planning",
    visual: {
      src: "/destinations/tokyo.svg",
      alt: "Original illustration of a quiet Tokyo skyline, a tower, and Mount Fuji in spring.",
    },
  },
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
      days: 5,
      status: "Completed",
    },
    {
      id: "miami",
      destination: "Miami",
      country: "USA",
      startDate: "2026-02-07",
      endDate: "2026-02-10",
      days: 3,
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

// Set upcomingTrip to null to show the first-trip state. This preset also removes history.
export const emptyDashboardMock: DashboardData = {
  ...dashboardMock,
  upcomingTrip: null,
  recentTrips: [],
  insight: {
    ...dashboardMock.insight,
    title: "Could Kyoto be your next chapter?",
  },
};

// Shared by the lightweight trip-route placeholders; no trip workspace is implemented.
export const mockTripDestinations = [
  ...(dashboardMock.upcomingTrip
    ? [
        {
          id: dashboardMock.upcomingTrip.id,
          destination: dashboardMock.upcomingTrip.destination,
          country: dashboardMock.upcomingTrip.country,
        },
      ]
    : []),
  ...dashboardMock.recentTrips.map(({ id, destination, country }) => ({
    id,
    destination,
    country,
  })),
];
