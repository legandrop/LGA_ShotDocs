import type { PracticeTexts } from './practiceTemplate';

// The practice page in English (Docs/Doc_Tutorial.md, sección 3): a short VFX shot.

export const practiceEn: PracticeTexts = {
  title: 'Shot 012 · Rooftop chase',
  brief: ['Lucía runs across the roofs and the chase ', 'ends on the building’s rooftop', '. Sky references in '],
  linkText: 'visual effects',
  linkUrl: 'https://en.wikipedia.org/wiki/Visual_effects',
  tasksTitle: 'Shot tasks',
  tasks: ['Tracking markers on the railing', 'Sky replacement', 'Paint out the safety wire'],
  scene: 'EXT. ROOFTOP - NIGHT',
  action: 'Lucía runs to the edge and looks down. The city, all lit up, below.',
  question: 'Is the sky replaced in every shot?',
  answer: 'Yes, all of them: the same sky as in sequence 011.',
  answerReply: 'Great, I’ll note it in the report.',
  takesTitle: 'Takes',
  takes: [
    ['Take', 'Lens', 'Note'],
    ['1', '35 mm', 'Goes out of focus at the end'],
    ['2', '35 mm', 'Good'],
    ['3', '50 mm', 'Selected'],
  ],
  notesTitle: 'Comp notes',
  notes: 'Add smoke from the chimneys and bring down the brightness of the background windows.',
};
