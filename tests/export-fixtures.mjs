export const exportDocument = {
  version: 1, exportedAt: "2026-11-06T10:00:00.000Z", destination: "Kyoto 京都", startDate: "2099-04-12", endDate: "2099-04-13",
  days: [{ dayNumber: 1, date: "2099-04-12", theme: "Discovery", items: [
    { type: "attraction", title: "Real saved place", period: "morning", latitude: 35, longitude: 135 },
    { type: "hotel", title: "Selected hotel", period: "afternoon", latitude: null, longitude: null },
    { type: "food", title: "Saved cafe", period: "evening", latitude: 35.1, longitude: 135.1 },
  ] }],
  hotel: { name: "Selected hotel", latitude: null, longitude: null }, food: [{ name: "Saved cafe", category: "cafe" }],
  budget: { currency: "USD", total: "1000.00", planned: "100.00", actual: "50.00", remaining: "850.00" }, notices: [],
};
