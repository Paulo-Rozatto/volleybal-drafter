import { useEffect, useState } from 'react';
import Avatar from '../ui/Avatar.jsx';
import { resolveAvatarUrl } from './profileApi.js';

export default function SocialAvatar({ name, seed, avatarPath, size = 36 }) {
  const [loaded, setLoaded] = useState({ path: null, url: null });

  useEffect(() => {
    if (!avatarPath) return undefined;
    let cancelled = false;
    resolveAvatarUrl(avatarPath).then((url) => {
      if (!cancelled) setLoaded({ path: avatarPath, url });
    });
    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  const src = loaded.path === avatarPath ? loaded.url : null;
  return <Avatar name={name} seed={seed} size={size} src={src} />;
}
