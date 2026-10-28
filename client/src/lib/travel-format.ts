const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatTripDates(startDate: string, endDate: string) {
  return dateFormatter.formatRange(
    new Date(`${startDate}T00:00:00Z`),
    new Date(`${endDate}T00:00:00Z`),
  );
}

export function formatTravelCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
