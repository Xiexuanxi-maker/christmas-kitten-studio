export interface Shot {
  id: string;
  title: string;
  start: number;
  end: number;
  subtitle: string;
  prompt: string;
  audio: string;
  category: string;
  kitten?: string;
  image: string;
}

const continuity = 'Vertical 9:16 premium Christmas product film. Photorealistic clear acrylic advent calendar gift set, polished transparent edges, gold lettering and gold hinges, a deep red satin bow, 24 numbered compartments, adorable flat acrylic kitten keychain charms with gold clasps. Warm amber fairy-light bokeh, deep forest green and burgundy Christmas decor, refined giftable styling, shallow depth of field. Maintain the same product design, lighting, scale and materials throughout. No on-screen text, no watermarks; English subtitles will be added in editing. Gentle cinematic camera motion, natural proportions, physically plausible hands and acrylic reflections.';
const shot = (value: Omit<Shot, 'image'> & { image?: string }): Shot => ({
  ...value,
  prompt: `${continuity}\n\n${value.prompt}`,
  image: value.image ?? '/images/calendar-hero.png',
});

export const initialShots: Shot[] = [
  shot({
    id: 'golden-three', title: 'A little Christmas magic', start: 0, end: 3,
    subtitle: 'The cutest Christmas countdown gift 🎄', category: 'The first impression',
    prompt: 'Slowly push toward the complete acrylic gift box on a Christmas-decorated tabletop. The deep red bow, transparent acrylic walls and subtle gold lettering come into sharp focus against blurred warm Christmas lights. A precious, beautifully wrapped gift. Keep this a single elegant establishing shot.',
    audio: 'One clear delicate sleigh bell, then soft Christmas instrumental music begins.',
  }),
  shot({
    id: 'unboxing', title: 'The sweetest unboxing', start: 3, end: 8,
    subtitle: '24 days. 24 tiny surprises.', category: 'The unboxing',
    prompt: 'A pair of clean natural hands gently unties the red satin bow and lifts the clear acrylic lid. Follow the lid opening to reveal all 24 small numbered compartments. Keep the opening action gentle, slow and tactile; preserve the premium construction and gold hinges.',
    audio: 'Close, delicate ribbon friction, the lid opening and a very soft acrylic tap. Christmas music stays low.',
  }),
  shot({
    id: 'first-kitten', title: 'Meet your first little friend', start: 8, end: 12,
    subtitle: 'Look at those tiny details…', category: 'The first surprise', kitten: 'Grey British Shorthair',
    prompt: 'A hand slides out compartment number 1 and carefully lifts a tiny grey British Shorthair acrylic kitten keychain charm. Macro focus on round bead-like eyes, a small red Santa hat, a cozy scarf, the polished clear acrylic edge and gold clasp. This is an acrylic charm, not a living kitten.',
    audio: 'A quiet sliding drawer, followed by the tiny charm gently tapping its gold clasp.', image: '/images/kitten-details.png',
  }),
  shot({
    id: 'packaging-front', title: 'A gift worth the countdown', start: 12, end: 15,
    subtitle: 'Acrylic Advent Calendar Gift Set', category: 'The gift set',
    prompt: 'Hold a stable, front-facing product shot of the entire complete acrylic advent calendar packaging. Clearly frame the front title area, Christmas illustrations, kitten hero illustration and complete 1–24 compartment layout. Show the product as one beautiful full gift set. Do not cut to a montage of 24 individual cats.',
    audio: 'Soft Christmas instrumental continues with one faint sparkling accent.',
  }),
  shot({
    id: 'packaging-detail', title: 'Made for a closer look', start: 15, end: 17,
    subtitle: 'Premium acrylic • polished edges', category: 'The gift set',
    prompt: 'Gently slide the camera sideways around the open gift box to show the thickness of premium acrylic, polished transparent edges, opening structure and small gold hinges. The calendar remains a tangible three-dimensional gift set with consistent details.',
    audio: 'A faint glassy shimmer over the soft music. No loud impacts.',
  }),
  shot({
    id: 'gifting-hero', title: 'Ready to make someone smile', start: 17, end: 20,
    subtitle: 'Perfect for gifting & collecting ✨', category: 'The gift set',
    prompt: 'Create an elegant complete-gift-set hero shot in front of a softly lit Christmas tree and wrapped presents. Frame the entire acrylic advent calendar with its red ribbon and a few small kitten keychains nearby, suggesting gifting, collecting and attaching the charms to a bag or keys.',
    audio: 'Gentle Christmas instrumental with a subtle sparkling accent.',
  }),
  shot({
    id: 'blue-eyed-baby', title: 'Blue-eyed baby', start: 20, end: 22.4,
    subtitle: 'Blue-eyed baby 🥹', category: 'The tiny details', kitten: 'Blue-eyed Ragdoll',
    prompt: 'Macro push toward the large blue eyes of a tiny Ragdoll kitten acrylic keychain charm, then gently pull back to reveal the full figure. Emphasize the beautiful blue eyes, red Christmas cape and tiny golden bell. This is a polished acrylic charm with clear edges and a gold clasp.',
    audio: 'One very light jingle as the charm appears. Christmas music remains soft.', image: '/images/kitten-details.png',
  }),
  shot({
    id: 'little-reindeer', title: 'A very merry little reindeer', start: 22.4, end: 24.8,
    subtitle: 'Little reindeer!', category: 'The tiny details', kitten: 'Reindeer Orange Tabby',
    prompt: 'A natural hand gently rotates a tiny orange tabby kitten acrylic keychain charm under warm light. Show the little reindeer antlers, green scarf and especially round face. Capture a delicate glint on the polished acrylic edge and gold clasp.',
    audio: 'One tiny click and a delicate jingle, with the quiet music underneath.', image: '/images/kitten-details.png',
  }),
  shot({
    id: 'christmas-magic', title: 'Tiny Christmas magic', start: 24.8, end: 27.2,
    subtitle: 'Tiny Christmas magic ✨', category: 'The tiny details', kitten: 'Golden-eyed Black Cat',
    prompt: 'Present a golden-eyed black kitten acrylic keychain charm in warm amber light. A slow close-up emphasizes the contrast between its deep black fur illustration, luminous golden eyes and bright red Christmas cape. Keep the transparent acrylic edge and gold clasp visible.',
    audio: 'A soft bright chime on the cut, with low warm Christmas music.', image: '/images/kitten-details.png',
  }),
  shot({
    id: 'santas-helper', title: 'Santa’s smallest helper', start: 27.2, end: 29.6,
    subtitle: 'Santa’s helper!', category: 'The tiny details', kitten: 'Christmas Elf Cat',
    prompt: 'Macro detail shot of a Christmas elf kitten acrylic keychain charm. Slowly reveal its pointed green elf hat, coordinating green elf costume and tiny bell on the gold clasp. The charm is small, polished and irresistibly cute, against warm Christmas bokeh.',
    audio: 'One gentle bell jingle as the charm turns. Keep the music soft.', image: '/images/kitten-details.png',
  }),
  shot({
    id: 'bookish-kitten', title: 'Too cute to handle', start: 29.6, end: 32,
    subtitle: 'Too cute to handle!', category: 'The tiny details', kitten: 'Bookish Glasses Cat',
    prompt: 'A close macro camera focuses on round-framed glasses worn by a tiny scholarly kitten acrylic charm, then reveals the small green Christmas book in its paws. Show the affectionate expression, transparent polished acrylic edge and gold keychain clasp.',
    audio: 'A very soft click and a tiny jingle on the cut. Gentle Christmas music continues.', image: '/images/kitten-details.png',
  }),
  shot({
    id: 'purrfect-finale', title: '24 days of purrfect surprises', start: 32, end: 40,
    subtitle: '24 Days of Purrfect Surprises 🎁\nWhich kitten is your favorite?', category: 'The final frame',
    prompt: 'Slowly pull back to the complete Christmas advent calendar acrylic gift set. Arrange a few selected kitten keychain charms in the foreground: blue-eyed Ragdoll, reindeer orange tabby, golden-eyed black cat, elf cat and glasses cat. Let the charms sway very gently for a tactile ASMR feeling. End on a steady, elegant hero shot of the complete box with red bow, Christmas tree lights and gift boxes behind it. Leave clean space for the closing title and interaction subtitle added in editing.',
    audio: 'The gentle Christmas instrumental resolves with a clear delicate closing bell. Faint charm movement.',
  }),
];
