import { useEffect, useState } from 'preact/hooks';

/** Renders a Blob as an <img>, owning the object URL's lifetime. */
export function Thumb(props: { blob?: Blob; alt: string; class?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!props.blob) {
      setUrl('');
      return;
    }
    const u = URL.createObjectURL(props.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [props.blob]);
  if (!url) return <div class={`thumb thumb-empty ${props.class ?? ''}`} aria-label={props.alt} role="img" />;
  return <img class={`thumb ${props.class ?? ''}`} src={url} alt={props.alt} draggable={false} />;
}
