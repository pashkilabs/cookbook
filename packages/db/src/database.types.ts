export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          deleted_at: string | null
          email: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      devices: {
        Row: {
          account_id: string
          created_at: string
          id: string
          last_seen_at: string | null
          platform: string
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          last_seen_at?: string | null
          platform: string
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          last_seen_at?: string | null
          platform?: string
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          app_key: string
          created_at: string
          family_id: string
          id: string
          quota_json: Json
          tier: string
          updated_at: string
          valid_until: string
        }
        Insert: {
          app_key: string
          created_at?: string
          family_id: string
          id?: string
          quota_json?: Json
          tier: string
          updated_at?: string
          valid_until: string
        }
        Update: {
          app_key?: string
          created_at?: string
          family_id?: string
          id?: string
          quota_json?: Json
          tier?: string
          updated_at?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_account_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          owner_account_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "families_owner_account_id_fkey"
            columns: ["owner_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          account_id: string | null
          colour: string | null
          created_at: string
          deleted_at: string | null
          display_name: string
          family_id: string
          id: string
          is_child: boolean
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          colour?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name: string
          family_id: string
          id?: string
          is_child?: boolean
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          colour?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          family_id?: string
          id?: string
          is_child?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      grocery_packages: {
        Row: {
          base_amount: number
          created_at: string
          id: string
          ingredient_id: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          base_amount: number
          created_at?: string
          id?: string
          ingredient_id: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          base_amount?: number
          created_at?: string
          id?: string
          ingredient_id?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grocery_packages_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      import_cache: {
        Row: {
          created_at: string
          extracted_json: Json | null
          fetched_at: string
          photo_path: string | null
          updated_at: string
          url_hash: string
        }
        Insert: {
          created_at?: string
          extracted_json?: Json | null
          fetched_at?: string
          photo_path?: string | null
          updated_at?: string
          url_hash: string
        }
        Update: {
          created_at?: string
          extracted_json?: Json | null
          fetched_at?: string
          photo_path?: string | null
          updated_at?: string
          url_hash?: string
        }
        Relationships: []
      }
      import_jobs: {
        Row: {
          created_at: string
          deleted_at: string | null
          error: string | null
          family_id: string
          id: string
          input_ref: string
          kind: string
          result_json: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          error?: string | null
          family_id: string
          id?: string
          input_ref: string
          kind: string
          result_json?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          error?: string | null
          family_id?: string
          id?: string
          input_ref?: string
          kind?: string
          result_json?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          aisle: string
          aliases: string[]
          can_size: number | null
          canonical_name: string
          created_at: string
          dimension: string
          grams_per_cup: number | null
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          aisle: string
          aliases?: string[]
          can_size?: number | null
          canonical_name: string
          created_at?: string
          dimension: string
          grams_per_cup?: number | null
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          aisle?: string
          aliases?: string[]
          can_size?: number | null
          canonical_name?: string
          created_at?: string
          dimension?: string
          grams_per_cup?: number | null
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      meal_plans: {
        Row: {
          created_at: string
          deleted_at: string | null
          family_id: string
          id: string
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          family_id: string
          id?: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          family_id?: string
          id?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_plans_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      pantry_items: {
        Row: {
          amount: number | null
          created_at: string
          deleted_at: string | null
          family_id: string
          id: string
          ingredient_id: string | null
          name: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          deleted_at?: string | null
          family_id: string
          id?: string
          ingredient_id?: string | null
          name: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          deleted_at?: string | null
          family_id?: string
          id?: string
          ingredient_id?: string | null
          name?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pantry_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pantry_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          deleted_at: string | null
          family_id: string
          height: number | null
          id: string
          recipe_id: string
          source: string
          storage_path: string
          updated_at: string
          width: number | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          family_id: string
          height?: number | null
          id?: string
          recipe_id: string
          source: string
          storage_path: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          family_id?: string
          height?: number | null
          id?: string
          recipe_id?: string
          source?: string
          storage_path?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_recipe"
            columns: ["recipe_id", "family_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      plan_entries: {
        Row: {
          cooked_at: string | null
          created_at: string
          date: string
          deleted_at: string | null
          family_id: string
          id: string
          meal_plan_id: string
          recipe_id: string
          scale: number
          updated_at: string
        }
        Insert: {
          cooked_at?: string | null
          created_at?: string
          date: string
          deleted_at?: string | null
          family_id: string
          id?: string
          meal_plan_id: string
          recipe_id: string
          scale?: number
          updated_at?: string
        }
        Update: {
          cooked_at?: string | null
          created_at?: string
          date?: string
          deleted_at?: string | null
          family_id?: string
          id?: string
          meal_plan_id?: string
          recipe_id?: string
          scale?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_entries_meal_plan"
            columns: ["meal_plan_id", "family_id"]
            isOneToOne: false
            referencedRelation: "meal_plans"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "plan_entries_recipe"
            columns: ["recipe_id", "family_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      ratings: {
        Row: {
          created_at: string
          deleted_at: string | null
          family_id: string
          family_member_id: string
          id: string
          rated_at: string
          recipe_id: string
          score: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          family_id: string
          family_member_id: string
          id?: string
          rated_at?: string
          recipe_id: string
          score: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          family_id?: string
          family_member_id?: string
          id?: string
          rated_at?: string
          recipe_id?: string
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_recipe"
            columns: ["recipe_id", "family_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          amount: number | null
          created_at: string
          deleted_at: string | null
          family_id: string
          id: string
          ingredient_id: string | null
          is_estimated: boolean
          item_text: string
          note: string
          position: number
          recipe_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          deleted_at?: string | null
          family_id: string
          id?: string
          ingredient_id?: string | null
          is_estimated?: boolean
          item_text: string
          note?: string
          position: number
          recipe_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          deleted_at?: string | null
          family_id?: string
          id?: string
          ingredient_id?: string | null
          is_estimated?: boolean
          item_text?: string
          note?: string
          position?: number
          recipe_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe"
            columns: ["recipe_id", "family_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          family_id: string
          id: string
          make_again: boolean | null
          servings: number | null
          source_name: string | null
          source_url: string | null
          status: string
          time_minutes: number | null
          times_made: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          family_id: string
          id?: string
          make_again?: boolean | null
          servings?: number | null
          source_name?: string | null
          source_url?: string | null
          status?: string
          time_minutes?: number | null
          times_made?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          family_id?: string
          id?: string
          make_again?: boolean | null
          servings?: number | null
          source_name?: string | null
          source_url?: string | null
          status?: string
          time_minutes?: number | null
          times_made?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      shortlist_entries: {
        Row: {
          created_at: string
          deleted_at: string | null
          family_id: string
          id: string
          recipe_id: string
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          family_id: string
          id?: string
          recipe_id: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          family_id?: string
          id?: string
          recipe_id?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "shortlist_entries_recipe"
            columns: ["recipe_id", "family_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          external_id: string
          family_id: string
          id: string
          provider: string
          renews_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id: string
          family_id: string
          id?: string
          provider: string
          renews_at?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string
          family_id?: string
          id?: string
          provider?: string
          renews_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      platform_spend_quota: {
        Args: {
          p_amount: number
          p_app_key: string
          p_family_id: string
          p_quota: string
        }
        Returns: Json
      }
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

