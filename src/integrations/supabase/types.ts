export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      calculator_scenarios: {
        Row: {
          assumptions_json: Json
          capacity_mwp: number | null
          capex_eur_kwp: number | null
          created_at: string
          id: string
          location: string | null
          merchant_share: number | null
          opex_fixed: number | null
          ppa_price: number | null
          results_json: Json
          scenario_name: string
          user_id: string | null
        }
        Insert: {
          assumptions_json?: Json
          capacity_mwp?: number | null
          capex_eur_kwp?: number | null
          created_at?: string
          id?: string
          location?: string | null
          merchant_share?: number | null
          opex_fixed?: number | null
          ppa_price?: number | null
          results_json?: Json
          scenario_name: string
          user_id?: string | null
        }
        Update: {
          assumptions_json?: Json
          capacity_mwp?: number | null
          capex_eur_kwp?: number | null
          created_at?: string
          id?: string
          location?: string | null
          merchant_share?: number | null
          opex_fixed?: number | null
          ppa_price?: number | null
          results_json?: Json
          scenario_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      capture_price_metrics: {
        Row: {
          baseload_price: number
          capture_price: number
          capture_rate: number
          created_at: string
          id: number
          negative_price_generation_share: number | null
          period: string
          technology: string
        }
        Insert: {
          baseload_price: number
          capture_price: number
          capture_rate: number
          created_at?: string
          id?: number
          negative_price_generation_share?: number | null
          period: string
          technology: string
        }
        Update: {
          baseload_price?: number
          capture_price?: number
          capture_rate?: number
          created_at?: string
          id?: number
          negative_price_generation_share?: number | null
          period?: string
          technology?: string
        }
        Relationships: []
      }
      cross_border_flows_hourly: {
        Row: {
          created_at: string
          datetime: string
          flow_mw: number
          from_zone: string
          id: number
          source: string
          to_zone: string
        }
        Insert: {
          created_at?: string
          datetime: string
          flow_mw: number
          from_zone: string
          id?: number
          source?: string
          to_zone: string
        }
        Update: {
          created_at?: string
          datetime?: string
          flow_mw?: number
          from_zone?: string
          id?: number
          source?: string
          to_zone?: string
        }
        Relationships: []
      }
      market_prices_hourly: {
        Row: {
          created_at: string
          datetime: string
          id: number
          market: string
          price_eur_mwh: number
          source: string
          volume_mwh: number | null
        }
        Insert: {
          created_at?: string
          datetime: string
          id?: number
          market?: string
          price_eur_mwh: number
          source?: string
          volume_mwh?: number | null
        }
        Update: {
          created_at?: string
          datetime?: string
          id?: number
          market?: string
          price_eur_mwh?: number
          source?: string
          volume_mwh?: number | null
        }
        Relationships: []
      }
      news_items: {
        Row: {
          ai_generated: boolean
          category: string
          created_at: string
          created_by: string | null
          date: string
          id: string
          original_url: string
          region: string
          source: string
          summary_en: string | null
          tags: string[]
          title: string
        }
        Insert: {
          ai_generated?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          original_url: string
          region?: string
          source: string
          summary_en?: string | null
          tags?: string[]
          title: string
        }
        Update: {
          ai_generated?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          original_url?: string
          region?: string
          source?: string
          summary_en?: string | null
          tags?: string[]
          title?: string
        }
        Relationships: []
      }
      res_generation_profiles: {
        Row: {
          created_at: string
          datetime: string
          generation_mwh_per_mw: number
          id: number
          location: string
          source: string
          technology: string
        }
        Insert: {
          created_at?: string
          datetime: string
          generation_mwh_per_mw: number
          id?: number
          location?: string
          source: string
          technology: string
        }
        Update: {
          created_at?: string
          datetime?: string
          generation_mwh_per_mw?: number
          id?: number
          location?: string
          source?: string
          technology?: string
        }
        Relationships: []
      }
      weekly_report_used_news: {
        Row: {
          title: string | null
          url: string
          used_at: string
          week_iso: string
        }
        Insert: {
          title?: string | null
          url: string
          used_at?: string
          week_iso: string
        }
        Update: {
          title?: string | null
          url?: string
          used_at?: string
          week_iso?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
