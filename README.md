# dog community

Browser voice chat room. Anyone who opens the site can join and talk.

- Static site on **Vercel**. **Supabase Realtime** is the meeting point: it tracks who's in the room
  and passes the connection setup between browsers. Voice goes directly between browsers (WebRTC).
- **Host** = whoever has been in the room longest (👑). If the host leaves, the next person becomes host.
- **Only the host** can mute someone for everyone or kick them. Every browser ignores mute/kick from anyone else
  and applies the host's mutes on the listening side. Kicked users are blocked for 5 minutes.
  There is no server of its own, so a technically skilled user could still get around this.
- Everyone can mute themselves and change each person's volume (only for themselves).

## Setup

1. Create a **new, empty** Supabase project, separate from anything holding private data. The key below ends up in the public page.
2. Put its Project URL and anon/publishable key in `public/config.js`.
3. Deploy the `public` folder: `npx vercel deploy public --prod`

Run locally: `python -m http.server 3000 -d public`, then open http://localhost:3000.

## Limits

Everyone sends their voice to everyone (mesh), which works well up to about 10–15 people talking.
Some strict networks need a TURN server; add one to `ICE` in `public/app.js`.
