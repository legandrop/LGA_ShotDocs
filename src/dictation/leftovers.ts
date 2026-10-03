import { listNotes, removeNote } from './queue';
import { loadVoiceSettings } from './voiceSettings';

// Lo del dictado que queda en el dispositivo al salir de la cuenta (Docs/Doc_Dictado.md, 8): las notas de voz sin
// ubicar de esa persona en ese workspace y la segunda clave de *Voice*. La ventana de salir (SignOutDialog) lo cuenta y
// ofrece borrarlo con casillas destildadas: nunca se borra en silencio.

export interface VoiceLeftovers {
  /** Cuántas notas de voz quedan en la cola de ese correo en ese workspace. */
  notes: number;
  /** Si hay una segunda clave de *Voice* guardada (de este dispositivo o de esta pestaña). */
  voiceKey: boolean;
}

export async function voiceLeftovers(email: string, workspace: string): Promise<VoiceLeftovers> {
  const [notes, voice] = await Promise.all([listNotes(email, workspace).catch(() => []), loadVoiceSettings(email).catch(() => null)]);
  return { notes: notes.length, voiceKey: !!voice?.hasKey };
}

/** Borra las notas de voz de esa persona en ese workspace (con sus grabaciones). Solo si la persona lo tildó al salir. */
export async function discardVoiceNotes(email: string, workspace: string): Promise<void> {
  for (const n of await listNotes(email, workspace)) await removeNote(n.id);
}
