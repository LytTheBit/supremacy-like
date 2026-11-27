/** User-facing texts live here so the interface can be translated in one place. */

export const RESOURCE_LABELS: Record<string, string> = {
  wood: 'Legno',
  iron: 'Ferro',
  grain: 'Grano',
  coal: 'Carbone',
};

export function resourceLabel(id: string): string {
  return RESOURCE_LABELS[id] ?? id;
}

const ERROR_TEXT: Record<string, string> = {
  game_over: 'La partita è finita',
  player_not_found: 'Giocatore non trovato',
  province_not_found: 'Provincia non trovata',
  army_not_found: 'Armata non trovata',
  not_owner: 'Non è tua',
  low_morale: 'Morale troppo basso',
  unknown_unit_type: 'Unità non disponibile in questa partita',
  unknown_building: 'Edificio non disponibile in questa partita',
  missing_building: 'Serve un edificio',
  invalid_count: 'Quantità non valida',
  enemy_present: 'Ci sono nemici nella provincia',
  insufficient_resources: 'Risorse insufficienti',
  already_built: 'Già costruito',
  not_coastal: 'Si può costruire solo su una provincia costiera',
  not_same_province: 'Devono trovarsi nello stesso porto',
  army_moving: 'L\'armata è in movimento',
  not_land_army: 'Serve un\'armata di terra',
  not_a_fleet: 'Serve una flotta',
  not_in_port: 'Serve un porto',
  over_capacity: 'Le navi non hanno abbastanza capacità',
  nothing_to_unload: 'Non c\'è nulla da sbarcare',
  already_building: 'Già in costruzione',
  already_there: "L'armata è già qui",
  no_path: 'Nessun percorso',
  same_player: 'Non puoi farlo con te stesso',
  player_eliminated: 'Il giocatore è stato eliminato',
  already_allied: 'Siete già alleati',
  already_at_war: 'Siete già in guerra',
  war_pending: 'Una dichiarazione di guerra è già in corso',
  already_proposed: 'Proposta già inviata',
  proposal_not_found: 'La proposta non esiste più',
  not_recipient: 'La proposta non è per te',
};

export function errorText(code: string): string {
  return ERROR_TEXT[code] ?? code;
}
