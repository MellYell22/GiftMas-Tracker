import { createClient } from '@supabase/supabase-js'

// Public browser configuration; access is protected by database row policies.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://czuxtspeuvfcqxsxqmho.supabase.co',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_CesTjgyG0uWQtNmHsVFB7w_H14P7JIk',
)
