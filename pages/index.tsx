import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [user, setUser] = useState(null);
  const [pitchesUsed, setPitchesUsed] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null));
  }, []);

  const login = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'github' });
    console.log("LOGIN DATA:", data);
    console.log("LOGIN ERROR:", error);
  };

  const handleSubmit = async () => {
    console.log("SUBMIT clicked");

    if (!user) return alert('Please log in first');
    if (pitchesUsed >= 5) return alert('You’ve used all 5 free pitches');

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, email: user.email }),
    });

    const data = await res.json();
    console.log("API RESPONSE:", data);
    setOutput(data.response);
    setPitchesUsed(prev => prev + 1);
  };

  return (
    <main style={{ padding: 40 }}>
      <h1>PR Copilot</h1>
      {!user && <button onClick={login}>Sign in with GitHub</button>}
      {user && (
        <>
          <p>Welcome {user.email}</p>
          <textarea rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} />
          <button onClick={handleSubmit}>Generate Pitch</button>
          <pre>{output}</pre>
          <p>{5 - pitchesUsed} free pitches remaining</p>
        </>
      )}
    </main>
  );
}