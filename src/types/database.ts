export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

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
          role: 'admin' | 'editor' | 'viewer'
          status: 'active' | 'inactive' | 'pending'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          user_id: string
          role: 'admin' | 'editor' | 'viewer'
          status?: 'active' | 'inactive' | 'pending'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          user_id?: string
          role?: 'admin' | 'editor' | 'viewer'
          status?: 'active' | 'inactive' | 'pending'
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