/** Barra de pieles en el shell: solo en `next dev`, no en producción. */
export const isUiStyleDevToolbarEnabled = process.env.NODE_ENV === 'development'
