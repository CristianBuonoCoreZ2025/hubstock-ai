export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type ProfileMemberRole = 'admin' | 'editor' | 'viewer'
export type ProfileMemberStatus = 'active' | 'inactive' | 'pending'
export type MovementType =
  | 'consumption'
  | 'purchase'
  | 'adjustment'
  | 'import'
  | 'inventory_count'
export type ReceiptStatus = 'pending_review' | 'confirmed' | 'rejected'
export type StockCheckStatus =
  | 'draft'
  | 'processing'
  | 'awaiting_confirmation'
  | 'completed'
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          name: string
          description: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      profile_members: {
        Row: {
          id: string
          profile_id: string
          user_id: string
          role: ProfileMemberRole
          status: ProfileMemberStatus
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          user_id: string
          role: ProfileMemberRole
          status?: ProfileMemberStatus
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          user_id?: string
          role?: ProfileMemberRole
          status?: ProfileMemberStatus
          created_at?: string
          updated_at?: string
        }
      }
      invitations: {
        Row: {
          id: string
          profile_id: string
          email: string
          role: ProfileMemberRole
          token: string
          expires_at: string
          invited_by: string
          status: InvitationStatus
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          email: string
          role: ProfileMemberRole
          token: string
          expires_at: string
          invited_by: string
          status?: InvitationStatus
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          email?: string
          role?: ProfileMemberRole
          token?: string
          expires_at?: string
          invited_by?: string
          status?: InvitationStatus
          created_at?: string
        }
      }
      invitation_targets: {
        Row: {
          invitation_id: string
          profile_id: string
          created_at: string
        }
        Insert: {
          invitation_id: string
          profile_id: string
          created_at?: string
        }
        Update: {
          invitation_id?: string
          profile_id?: string
          created_at?: string
        }
      }
      sections: {
        Row: {
          id: string
          name: string
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          sort_order: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number
          created_at?: string
        }
      }
      categories: {
        Row: {
          id: string
          section_id: string
          name: string
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          section_id: string
          name: string
          sort_order: number
          created_at?: string
        }
        Update: {
          id?: string
          section_id?: string
          name?: string
          sort_order?: number
          created_at?: string
        }
      }
      catalog_brands: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
      }
      catalog_products: {
        Row: {
          id: string
          section_id: string
          category_id: string
          name: string
          brand: string | null
          brand_id: string | null
          format: string | null
          unit: string | null
          default_reference_price: number | null
          sort_order: number
          active: boolean
          source_system: string | null
          source_product_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          section_id: string
          category_id: string
          name: string
          brand?: string | null
          brand_id?: string | null
          format?: string | null
          unit?: string | null
          default_reference_price?: number | null
          sort_order?: number
          active?: boolean
          source_system?: string | null
          source_product_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          section_id?: string
          category_id?: string
          name?: string
          brand?: string | null
          brand_id?: string | null
          format?: string | null
          unit?: string | null
          default_reference_price?: number | null
          sort_order?: number
          active?: boolean
          source_system?: string | null
          source_product_url?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      catalog_product_media: {
        Row: {
          id: string
          catalog_product_id: string
          kind: string
          bucket_id: string
          object_path: string
          public_url: string
          created_at: string
        }
        Insert: {
          id?: string
          catalog_product_id: string
          kind?: string
          bucket_id?: string
          object_path: string
          public_url: string
          created_at?: string
        }
        Update: {
          id?: string
          catalog_product_id?: string
          kind?: string
          bucket_id?: string
          object_path?: string
          public_url?: string
          created_at?: string
        }
      }
      catalog_product_aliases: {
        Row: {
          id: string
          catalog_product_id: string
          alias_normalized: string
          created_at: string
        }
        Insert: {
          id?: string
          catalog_product_id: string
          alias_normalized: string
          created_at?: string
        }
        Update: {
          id?: string
          catalog_product_id?: string
          alias_normalized?: string
          created_at?: string
        }
      }
      catalog_retail_snapshots: {
        Row: {
          id: string
          retailer: string
          external_ref: string
          source_url: string | null
          title: string
          price: number
          category_hint: string | null
          brand_hint: string | null
          captured_at: string
          match_method: string | null
        }
        Insert: {
          id?: string
          retailer: string
          external_ref: string
          source_url?: string | null
          title: string
          price: number
          category_hint?: string | null
          brand_hint?: string | null
          captured_at?: string
          match_method?: string | null
        }
        Update: {
          id?: string
          retailer?: string
          external_ref?: string
          source_url?: string | null
          title?: string
          price?: number
          category_hint?: string | null
          brand_hint?: string | null
          captured_at?: string
          match_method?: string | null
        }
      }
      catalog_retail_links: {
        Row: {
          retailer: string
          external_ref: string
          catalog_product_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          retailer: string
          external_ref: string
          catalog_product_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          retailer?: string
          external_ref?: string
          catalog_product_id?: string
          created_at?: string
          updated_at?: string
        }
      }
      products: {
        Row: {
          id: string
          profile_id: string
          section_id: string
          category_id: string
          name: string
          brand: string | null
          format: string | null
          unit: string | null
          gtin: string | null
          enrichment_source: 'open_food_facts' | 'manual' | null
          enrichment_synced_at: string | null
          stock_current: number
          stock_min: number | null
          stock_ideal: number | null
          reference_price: number | null
          last_price: number | null
          location: string | null
          image_url: string | null
          active: boolean
          catalog_product_id: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          section_id: string
          category_id: string
          name: string
          brand?: string | null
          format?: string | null
          unit?: string | null
          gtin?: string | null
          enrichment_source?: 'open_food_facts' | 'manual' | null
          enrichment_synced_at?: string | null
          stock_current?: number
          stock_min?: number | null
          stock_ideal?: number | null
          reference_price?: number | null
          last_price?: number | null
          location?: string | null
          image_url?: string | null
          active?: boolean
          catalog_product_id?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          section_id?: string
          category_id?: string
          name?: string
          brand?: string | null
          format?: string | null
          unit?: string | null
          gtin?: string | null
          enrichment_source?: 'open_food_facts' | 'manual' | null
          enrichment_synced_at?: string | null
          stock_current?: number
          stock_min?: number | null
          stock_ideal?: number | null
          reference_price?: number | null
          last_price?: number | null
          location?: string | null
          image_url?: string | null
          active?: boolean
          catalog_product_id?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      product_images: {
        Row: {
          id: string
          profile_id: string
          product_id: string
          storage_path: string
          sort_order: number
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          product_id: string
          storage_path: string
          sort_order?: number
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          product_id?: string
          storage_path?: string
          sort_order?: number
          created_by?: string
          created_at?: string
        }
      }
      stock_movements: {
        Row: {
          id: string
          profile_id: string
          product_id: string
          delta: number
          movement_type: MovementType
          note: string | null
          reference_id: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          product_id: string
          delta: number
          movement_type: MovementType
          note?: string | null
          reference_id?: string | null
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          product_id?: string
          delta?: number
          movement_type?: MovementType
          note?: string | null
          reference_id?: string | null
          created_by?: string
          created_at?: string
        }
      }
      shopping_trips: {
        Row: {
          id: string
          profile_id: string
          started_at: string
          completed_at: string | null
          store_name: string | null
          notes: string | null
          created_by: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          started_at?: string
          completed_at?: string | null
          store_name?: string | null
          notes?: string | null
          created_by: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          started_at?: string
          completed_at?: string | null
          store_name?: string | null
          notes?: string | null
          created_by?: string
          updated_at?: string
        }
      }
      shopping_trip_items: {
        Row: {
          id: string
          trip_id: string
          product_id: string
          quantity_planned: number
          quantity_bought: number | null
          unit_price_paid: number | null
          is_checked: boolean
          sort_order: number
        }
        Insert: {
          id?: string
          trip_id: string
          product_id: string
          quantity_planned?: number
          quantity_bought?: number | null
          unit_price_paid?: number | null
          is_checked?: boolean
          sort_order?: number
        }
        Update: {
          id?: string
          trip_id?: string
          product_id?: string
          quantity_planned?: number
          quantity_bought?: number | null
          unit_price_paid?: number | null
          is_checked?: boolean
          sort_order?: number
        }
      }
      purchase_receipts: {
        Row: {
          id: string
          profile_id: string
          store_name: string | null
          purchased_at: string | null
          total: number | null
          image_storage_path: string | null
          raw_analysis: Json | null
          status: ReceiptStatus
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          store_name?: string | null
          purchased_at?: string | null
          total?: number | null
          image_storage_path?: string | null
          raw_analysis?: Json | null
          status?: ReceiptStatus
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          store_name?: string | null
          purchased_at?: string | null
          total?: number | null
          image_storage_path?: string | null
          raw_analysis?: Json | null
          status?: ReceiptStatus
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      purchase_receipt_items: {
        Row: {
          id: string
          receipt_id: string
          product_id: string | null
          name_raw: string
          quantity: number | null
          unit_price: number | null
          line_total: number | null
          sort_order: number
          gtin: string | null
          enrichment: Json | null
        }
        Insert: {
          id?: string
          receipt_id: string
          product_id?: string | null
          name_raw: string
          quantity?: number | null
          unit_price?: number | null
          line_total?: number | null
          sort_order?: number
          gtin?: string | null
          enrichment?: Json | null
        }
        Update: {
          id?: string
          receipt_id?: string
          product_id?: string | null
          name_raw?: string
          quantity?: number | null
          unit_price?: number | null
          line_total?: number | null
          sort_order?: number
          gtin?: string | null
          enrichment?: Json | null
        }
      }
      stock_checks: {
        Row: {
          id: string
          profile_id: string
          zone: string
          status: StockCheckStatus
          created_by: string
          created_at: string
          updated_at: string
          ai_meta: Json | null
        }
        Insert: {
          id?: string
          profile_id: string
          zone: string
          status?: StockCheckStatus
          created_by: string
          created_at?: string
          updated_at?: string
          ai_meta?: Json | null
        }
        Update: {
          id?: string
          profile_id?: string
          zone?: string
          status?: StockCheckStatus
          created_by?: string
          created_at?: string
          updated_at?: string
          ai_meta?: Json | null
        }
      }
      stock_check_photos: {
        Row: {
          id: string
          stock_check_id: string
          storage_path: string
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          stock_check_id: string
          storage_path: string
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          stock_check_id?: string
          storage_path?: string
          sort_order?: number
          created_at?: string
        }
      }
      profile_brands: {
        Row: {
          id: string
          profile_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          name?: string
          created_at?: string
        }
      }
      profile_presentations: {
        Row: {
          id: string
          profile_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          name?: string
          created_at?: string
        }
      }
      profile_product_types: {
        Row: {
          id: string
          profile_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          name?: string
          created_at?: string
        }
      }
      stock_measure_units: {
        Row: {
          id: string
          code: string
          label: string
          sort_order: number
        }
        Insert: {
          id?: string
          code: string
          label: string
          sort_order?: number
        }
        Update: {
          id?: string
          code?: string
          label?: string
          sort_order?: number
        }
      }
      stock_net_content_options: {
        Row: {
          id: string
          label: string
          net_quantity: number
          unit_code: string
          sort_order: number
        }
        Insert: {
          id?: string
          label: string
          net_quantity: number
          unit_code: string
          sort_order?: number
        }
        Update: {
          id?: string
          label?: string
          net_quantity?: number
          unit_code?: string
          sort_order?: number
        }
      }
      stock_check_detected_items: {
        Row: {
          id: string
          stock_check_id: string
          product_id: string | null
          name_guess: string
          brand_guess: string | null
          product_type_guess: string | null
          presentation_guess: string | null
          net_quantity: number | null
          net_unit: string | null
          notes: string | null
          quantity_guess: number | null
          confidence: number | null
          accepted: boolean | null
          marked_invalid: boolean
          created_at: string
        }
        Insert: {
          id?: string
          stock_check_id: string
          product_id?: string | null
          name_guess: string
          brand_guess?: string | null
          product_type_guess?: string | null
          presentation_guess?: string | null
          net_quantity?: number | null
          net_unit?: string | null
          notes?: string | null
          quantity_guess?: number | null
          confidence?: number | null
          accepted?: boolean | null
          marked_invalid?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          stock_check_id?: string
          product_id?: string | null
          name_guess?: string
          brand_guess?: string | null
          product_type_guess?: string | null
          presentation_guess?: string | null
          net_quantity?: number | null
          net_unit?: string | null
          notes?: string | null
          quantity_guess?: number | null
          confidence?: number | null
          accepted?: boolean | null
          marked_invalid?: boolean
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_pending_invitations_for_current_user: {
        Args: Record<string, never>
        Returns: undefined
      }
      catalog_brand_id_for_label: {
        Args: { p_name: string }
        Returns: string | null
      }
      catalog_retail_listings_page: {
        Args: {
          p_retailer: string | null
          p_unlinked_only: boolean
          p_search: string | null
          p_page: number
          p_page_size: number
        }
        Returns: {
          snapshot_id: string
          retailer: string
          external_ref: string
          source_url: string | null
          title: string
          price: number
          category_hint: string | null
          brand_hint: string | null
          captured_at: string
          catalog_product_id: string | null
          linked_product_name: string | null
          total_count: number
        }[]
      }
      catalog_retail_match_candidates: {
        Args: {
          p_search_title: string
          p_price: number | null
          p_category_id: string | null
          p_limit: number | null
        }
        Returns: {
          catalog_product_id: string
          product_name: string
          category_id: string
          default_reference_price: number | null
          match_score: number
        }[]
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
