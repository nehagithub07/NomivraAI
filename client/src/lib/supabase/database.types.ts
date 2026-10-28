import type {
  AccommodationType, BudgetStyle, Currency, DietaryPreference,
  TravelPace, TripInterest, TripStatus,
} from "@/lib/trips/options";

// Maintained alongside supabase/migrations until CLI type generation is configured.
export type TripRow = {
  id: string;
  owner_id: string;
  destination_name: string;
  destination_place_id: string | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  destination_timezone: string | null;
  start_date: string;
  end_date: string;
  travelers_count: number;
  budget_total: number;
  currency: Currency;
  budget_style: BudgetStyle;
  travel_pace: TravelPace;
  accommodation_preferences: AccommodationType[];
  dietary_preferences: DietaryPreference[];
  special_requests: string | null;
  status: TripStatus;
  created_at: string;
  updated_at: string;
};
type TripInterestRow = { id: string; trip_id: string; interest: TripInterest; created_at: string };

export type CreateTripArguments = {
  p_destination_name: string;
  p_start_date: string;
  p_end_date: string;
  p_travelers_count: number;
  p_budget_total: string;
  p_currency: Currency;
  p_budget_style: BudgetStyle;
  p_travel_pace: TravelPace;
  p_accommodation_preferences: AccommodationType[];
  p_dietary_preferences: DietaryPreference[];
  p_special_requests: string | null;
  p_interests: TripInterest[];
  p_time_zone: string;
};

export type Database = {
  public: {
    Tables: {
      trips: {
        Row: TripRow;
        Insert: Omit<TripRow, "id" | "created_at" | "updated_at" | "destination_place_id" | "destination_latitude" | "destination_longitude" | "destination_timezone"> & Partial<Pick<TripRow, "id" | "created_at" | "updated_at" | "destination_place_id" | "destination_latitude" | "destination_longitude" | "destination_timezone">>;
        Update: Partial<TripRow>;
        Relationships: [];
      };
      trip_interests: {
        Row: TripInterestRow;
        Insert: Omit<TripInterestRow, "id" | "created_at"> & Partial<Pick<TripInterestRow, "id" | "created_at">>;
        Update: Partial<TripInterestRow>;
        Relationships: [{ foreignKeyName: "trip_interests_trip_id_fkey"; columns: ["trip_id"]; isOneToOne: false; referencedRelation: "trips"; referencedColumns: ["id"] }];
      };
    };
    Views: { [_ in never]: never };
    Functions: { create_trip_with_interests: { Args: CreateTripArguments; Returns: string } };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
