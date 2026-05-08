/**
 * Lista de países LATAM usada en filtros y formularios.
 * Fuente única para Clients, Revenue, y cualquier módulo que filtre por país.
 */
export const LATAM_COUNTRIES = [
  'Argentina', 'Belice', 'Bolivia', 'Brasil', 'Chile', 'Colombia', 'Costa Rica',
  'Cuba', 'Ecuador', 'El Salvador', 'Guatemala', 'Guyana', 'Haití', 'Honduras',
  'México', 'Nicaragua', 'Panamá', 'Paraguay', 'Perú', 'Puerto Rico',
  'República Dominicana', 'Surinam', 'Uruguay', 'Venezuela',
];

/** Opciones listas para FilterableSelect: [{ id, label }] */
export const COUNTRY_OPTIONS = LATAM_COUNTRIES.map((c) => ({ id: c, label: c }));
