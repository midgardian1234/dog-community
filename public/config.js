// Supabase project used only as the meeting point for voice chat (no tables needed).
// The publishable key is public by design. Use a project that holds no private data.
window.DOG_CONFIG = {
  url: 'https://lzkuymokvycuqcvnamrv.supabase.co',
  anonKey: 'sb_publishable_KF2KSy-ZUTxDQzrO0oLCvA_6DL-JQaI',

  // top-left X button
  xUrl: 'https://x.com',

  // memes shown when clicking the hook (top-right). Drop images in public/memes/ and list them here.
  memes: [
    'memes/egg.jpg',
    'memes/cone.jpg',
  ],
};
