// Supabase project used only as the meeting point for voice chat (no tables needed).
// The publishable key is public by design. Use a project that holds no private data.
window.DOG_CONFIG = {
  url: 'https://lzkuymokvycuqcvnamrv.supabase.co',
  anonKey: 'sb_publishable_KF2KSy-ZUTxDQzrO0oLCvA_6DL-JQaI',

  // top-left X button
  xUrl: 'https://x.com',

  // memes shown when clicking the hook (top-right). Drop images in public/memes/ and list them here.
  memes: [
    'memes/laser.jpg',
    'memes/crown.jpg',
    'memes/bear.jpg',
    'memes/cone.jpg',
    'memes/egg.jpg',
    'memes/propeller.jpg',
    'memes/helmet.jpg',
    'memes/cheese.jpg',
    'memes/solana.jpg',
    'memes/cowboy.jpg',
  ],
};
