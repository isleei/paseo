import { useCallback, useEffect, useMemo, useState } from "react";
import { Image } from "react-native";
import type { ProjectIconImageProps } from "@/components/project-icon-image";

/**
 * Web has one image path, and it has to hand back the fallback the native module gives
 * up-front for formats it cannot decode. A payload the browser rejects otherwise leaves
 * an empty box: the fallback carries the box's colour and radius, the bare image does not.
 */
export function ProjectIconImage({ dataUri, fallback, style }: ProjectIconImageProps) {
  const [errored, setErrored] = useState(false);
  const source = useMemo(() => ({ uri: dataUri }), [dataUri]);

  // A new data URI is a new attempt, so a previous failure must not follow it.
  useEffect(() => setErrored(false), [dataUri]);
  const handleError = useCallback(() => setErrored(true), []);

  if (errored) return fallback;
  return <Image source={source} style={style} onError={handleError} />;
}
