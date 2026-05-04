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
        }
        Insert: {
          id?: string
          profile_id: string
          zone: string
          status?: StockCheckStatus
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          zone?: string
          status?: StockCheckStatus
          created_by?: string
          created_at?: string
          updated_at?: string
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
      stock_check_detected_items: {
        Row: {
          id: string
          stock_check_id: string
          product_id: string | null
          name_guess: string
          quantity_guess: number | null
          confidence: number | null
          accepted: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          stock_check_id: string
          product_id?: string | null
          name_guess: string
          quantity_guess?: number | null
          confidence?: number | null
          accepted?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          stock_check_id?: string
          product_id?: string | null
          name_guess?: string
          quantity_guess?: number | null
          confidence?: number | null
          accepted?: boolean | null
          created_at?: string
        }
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
