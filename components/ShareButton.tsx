"use client";

export default function ShareButton({ text }: { text: string }) {
  const href = `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`;
  return (
    <a className="share-btn" href={href} target="_blank" rel="noopener noreferrer">
      🧵 Threadsでシェア
    </a>
  );
}
