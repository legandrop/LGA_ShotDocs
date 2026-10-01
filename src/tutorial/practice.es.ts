import type { PracticeTexts } from './practiceTemplate';

// La página de práctica en castellano (Docs/Doc_Tutorial.md, sección 3): un plano de VFX corto.

export const practiceEs: PracticeTexts = {
  title: 'Plano 012 · Persecución en la terraza',
  brief: ['Lucía escapa por los techos y la persecución ', 'termina en la terraza del edificio', '. Referencias de cielo en '],
  linkText: 'efectos visuales',
  linkUrl: 'https://es.wikipedia.org/wiki/Efectos_visuales',
  tasksTitle: 'Tareas del plano',
  tasks: ['Marcas de tracking en la baranda', 'Reemplazo de cielo', 'Limpiar el cable de seguridad'],
  scene: 'EXT. TERRAZA - NOCHE',
  action: 'Lucía corre hasta el borde y mira hacia abajo. La ciudad, encendida, debajo.',
  question: '¿El cielo se reemplaza en todos los planos?',
  answer: 'Sí, en todos: el mismo cielo que en la secuencia 011.',
  answerReply: 'Perfecto, lo dejo anotado en el reporte.',
  takesTitle: 'Tomas',
  takes: [
    ['Toma', 'Lente', 'Nota'],
    ['1', '35 mm', 'Se va de foco al final'],
    ['2', '35 mm', 'Bien'],
    ['3', '50 mm', 'Elegida'],
  ],
  notesTitle: 'Notas de compo',
  notes: 'Agregar humo de las chimeneas y bajar el brillo de las ventanas del fondo.',
};
