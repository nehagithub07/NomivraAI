import type {
  AccommodationType, BudgetStyle, Currency, DietaryPreference,
  TravelPace, TripInterest, TripStatus,
} from "@/lib/trips/options";

// Maintained alongside supabase/migrations until CLI type generation is configured.
export type TripRow = {
  id: string;
  owner_id: string;
  destination_name: string;
  destination_provider: string | null;
  destination_provider_id: string | null;
  destination_display_name: string | null;
  destination_country: string | null;
  destination_country_code: string | null;
  destination_admin1: string | null;
  destination_admin2: string | null;
  destination_feature_code: string | null;
  destination_population: number | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  destination_timezone: string | null;
  destination_types: string[];
  destination_utc_offset_minutes: number | null;
  destination_enriched_at: string | null;
  destination_content_expires_at: string | null;
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
type TripOptionalColumn = "id" | "created_at" | "updated_at" | "destination_provider" | "destination_provider_id" |
  "destination_latitude" | "destination_longitude" | "destination_timezone" |
  "destination_display_name" | "destination_types" | "destination_utc_offset_minutes" |
  "destination_enriched_at" | "destination_content_expires_at" | "destination_country" | "destination_country_code" |
  "destination_admin1" | "destination_admin2" | "destination_feature_code" | "destination_population";
export type PlaceRow = {
  id: string; provider: string; provider_place_id: string; name: string | null;
  formatted_address: string | null; latitude: number | null; longitude: number | null;
  category: string | null; metadata: { [key: string]: string } | null; types: string[]; created_at: string; updated_at: string;
  last_refreshed_at: string; content_expires_at: string | null;
};
type TripCandidateRow = { id: string; trip_id: string; place_id: string; candidate_category: string; source: string; distance_km: number | null; created_at: string };
export type AccommodationSelectionRow = {
  id: string; trip_id: string; provider: "stayapi" | "fixture";
  provider_accommodation_id: string; selected_name: string | null;
  search_context: Record<string, unknown>; selected_at: string;
};
export type FoodSelectionRow = {
  id: string; trip_id: string; provider: "geoapify" | "fixture"; provider_place_id: string;
  name: string; category: "restaurant" | "cafe" | "bar" | "pub" | "fast_food" | "food_court" | "dessert" | "other"; saved_at: string;
};
export type BudgetEntryRow = {
  id: string; trip_id: string;
  category: "accommodation" | "food" | "activities" | "transport" | "miscellaneous";
  entry_type: "planned" | "actual"; description: string; amount: number | string;
  currency: Currency; source: "manual"; expense_date: string | null;
  created_at: string; updated_at: string;
};
export type ItineraryVersionRow = {
  generation_reason: "initial" | "weather_adaptation" | "companion_edit"; parent_version_id: string | null; weather_fetched_at: string | null;
  id: string; trip_id: string; request_id: string; version_number: number;
  status: "generating" | "ready" | "failed"; is_current: boolean;
  provider: "gemini" | "fixture" | null; model_name: string | null; prompt_version: string | null; demo: boolean;
  title: string | null; summary: string | null; warnings: string[]; trip_context: Record<string, unknown>;
  document_hash: string | null; created_at: string; completed_at: string | null;
};
type ItineraryDayRow = { id: string; itinerary_version_id: string; day_number: number; trip_date: string; theme: string };
type ItineraryItemRow = {
  id: string; itinerary_day_id: string; position: number; period: "morning" | "afternoon" | "evening";
  candidate_type: "attraction" | "food" | "hotel" | "free_time"; candidate_provider: string | null; candidate_id: string | null;
  place_id: string | null; food_selection_id: string | null; hotel_selection_id: string | null;
  title: string; reason: string; notes: string | null; category: string | null;
  latitude: number | null; longitude: number | null; opening_hours: string | null;
};

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
      companion_conversations: { Row: { id: string; trip_id: string; user_id: string; active_request: string | null; active_until: string | null; created_at: string; updated_at: string }; Insert: never; Update: never; Relationships: [] };
      companion_messages: { Row: { id: string; conversation_id: string; role: "user" | "assistant"; content: string; reply_to: string | null; metadata: Record<string, unknown>; created_at: string }; Insert: never; Update: never; Relationships: [] };
      companion_pending_actions: { Row: { id: string; trip_id: string; user_id: string; tool_name: string; arguments: Record<string, unknown>; snapshot: Record<string, unknown>; preview: Record<string, unknown>; status: string; result: Record<string, unknown> | null; expires_at: string; created_at: string; confirmed_at: string | null; completed_at: string | null }; Insert: never; Update: never; Relationships: [] };
      trip_budget_entries: {
        Row: BudgetEntryRow;
        Insert: Omit<BudgetEntryRow, "source" | "created_at" | "updated_at">;
        Update: Partial<Pick<BudgetEntryRow, "category" | "entry_type" | "description" | "amount" | "currency" | "expense_date">>;
        Relationships: [{ foreignKeyName: "trip_budget_entries_trip_id_fkey"; columns: ["trip_id"]; isOneToOne: false; referencedRelation: "trips"; referencedColumns: ["id"] }];
      };
      itinerary_versions: { Row: ItineraryVersionRow; Insert: never; Update: never;
        Relationships: [{ foreignKeyName: "itinerary_versions_trip_id_fkey"; columns: ["trip_id"]; isOneToOne: false; referencedRelation: "trips"; referencedColumns: ["id"] }]; };
      itinerary_days: { Row: ItineraryDayRow; Insert: never; Update: never;
        Relationships: [{ foreignKeyName: "itinerary_days_itinerary_version_id_fkey"; columns: ["itinerary_version_id"]; isOneToOne: false; referencedRelation: "itinerary_versions"; referencedColumns: ["id"] }]; };
      itinerary_items: { Row: ItineraryItemRow; Insert: never; Update: never;
        Relationships: [{ foreignKeyName: "itinerary_items_itinerary_day_id_fkey"; columns: ["itinerary_day_id"]; isOneToOne: false; referencedRelation: "itinerary_days"; referencedColumns: ["id"] }]; };
      trip_food_selections: {
        Row: FoodSelectionRow; Insert: never; Update: never;
        Relationships: [{ foreignKeyName: "trip_food_selections_trip_id_fkey"; columns: ["trip_id"]; isOneToOne: false; referencedRelation: "trips"; referencedColumns: ["id"] }];
      };
      trip_accommodation_selections: {
        Row: AccommodationSelectionRow; Insert: never; Update: never;
        Relationships: [{ foreignKeyName: "trip_accommodation_selections_trip_id_fkey"; columns: ["trip_id"]; isOneToOne: true; referencedRelation: "trips"; referencedColumns: ["id"] }];
      };
      trips: {
        Row: TripRow;
        Insert: Omit<TripRow, TripOptionalColumn> & Partial<Pick<TripRow, TripOptionalColumn>>;
        Update: Partial<TripRow>;
        Relationships: [];
      };
      trip_interests: {
        Row: TripInterestRow;
        Insert: Omit<TripInterestRow, "id" | "created_at"> & Partial<Pick<TripInterestRow, "id" | "created_at">>;
        Update: Partial<TripInterestRow>;
        Relationships: [{ foreignKeyName: "trip_interests_trip_id_fkey"; columns: ["trip_id"]; isOneToOne: false; referencedRelation: "trips"; referencedColumns: ["id"] }];
      };
      places: { Row: PlaceRow; Insert: never; Update: never; Relationships: [] };
      trip_place_candidates: {
        Row: TripCandidateRow; Insert: never; Update: never;
        Relationships: [{ foreignKeyName: "trip_place_candidates_place_id_fkey"; columns: ["place_id"]; isOneToOne: false; referencedRelation: "places"; referencedColumns: ["id"] }];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      begin_companion_message: { Args: { p_trip_id: string; p_request_id: string; p_content: string }; Returns: unknown };
      finish_companion_message: { Args: { p_payload: string; p_signature: string; p_document: string }; Returns: string };
      prepare_companion_action: { Args: { p_payload: string; p_signature: string; p_document: string }; Returns: string };
      claim_companion_action: { Args: { p_payload: string; p_signature: string }; Returns: unknown };
      finish_companion_action: { Args: { p_payload: string; p_signature: string }; Returns: undefined };
      begin_companion_itinerary_edit: { Args: { p_trip_id: string; p_request_id: string; p_parent_version_id: string }; Returns: string };
      complete_companion_itinerary_edit: { Args: { p_payload: string; p_signature: string; p_document: string }; Returns: string };
      begin_weather_adaptation: { Args: { p_trip_id: string; p_request_id: string; p_parent_version_id: string }; Returns: string };
      complete_weather_adaptation: { Args: { p_payload: string; p_signature: string; p_document: string }; Returns: string };
      begin_itinerary_generation: { Args: { p_trip_id: string; p_request_id: string; p_regenerate?: boolean }; Returns: string };
      complete_itinerary_generation: { Args: { p_payload: string; p_signature: string; p_document: string }; Returns: string };
      fail_itinerary_generation: { Args: { p_payload: string; p_signature: string }; Returns: undefined };
      save_trip_food: { Args: { p_payload: string; p_signature: string }; Returns: string };
      select_trip_accommodation: { Args: { p_payload: string; p_signature: string; p_expected_id: string | null }; Returns: string };
      create_trip_with_interests: { Args: CreateTripArguments; Returns: string };
      create_resolved_trip: { Args: { p_form: CreateTripArguments; p_payload: string; p_signature: string }; Returns: string };
      persist_trip_place_candidates: { Args: { p_payload: string; p_signature: string }; Returns: number };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
