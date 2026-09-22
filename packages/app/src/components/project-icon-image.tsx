import { Buffer } from "buffer";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { Image, type ImageStyle, type StyleProp, View } from "react-native";
import { SvgCss } from "react-native-svg/css";
import { parseIconDataUri } from "@/components/project-icon-data-uri";

const SVG_MIME_TYPE = "image/svg+xml";
const ICO_MIME_TYPES = new Set(["image/x-icon", "image/vnd.microsoft.icon"]);
const SVG_CONTAINER = { overflow: "hidden" } as const;

export interface ProjectIconImageProps {
  dataUri: string;
  fallback: ReactElement;
  style: StyleProp<ImageStyle>;
}

function ignoreSvgParseError() {
  // Invalid repository SVGs use the same fallback as unsupported icon formats.
}

/**
 * A raster icon the platform refused to decode falls back like the SVG and ICO paths do.
 * Without this the row keeps an empty box: the fallback is the only thing that carries the
 * project's colour and initial.
 */
function ProjectIconRaster({
  source,
  style,
  fallback,
}: {
  source: { uri: string };
  style: StyleProp<ImageStyle>;
  fallback: ReactElement;
}) {
  const [errored, setErrored] = useState(false);

  useEffect(() => setErrored(false), [source]);
  const handleError = useCallback(() => setErrored(true), []);

  if (errored) return fallback;
  return <Image source={source} style={style} onError={handleError} />;
}

export function ProjectIconImage({ dataUri, fallback, style }: ProjectIconImageProps) {
  const source = useMemo(() => ({ uri: dataUri }), [dataUri]);
  const parts = useMemo(() => parseIconDataUri(dataUri), [dataUri]);
  const svgXml = useMemo(
    () =>
      parts?.mimeType === SVG_MIME_TYPE
        ? Buffer.from(parts.payload, "base64").toString("utf8")
        : null,
    [parts],
  );
  const svgContainerStyle = useMemo(() => [style, SVG_CONTAINER], [style]);

  if (svgXml) {
    return (
      <View style={svgContainerStyle}>
        <SvgCss
          xml={svgXml}
          width="100%"
          height="100%"
          fallback={fallback}
          onError={ignoreSvgParseError}
        />
      </View>
    );
  }
  if (!parts || ICO_MIME_TYPES.has(parts.mimeType)) return fallback;
  return <ProjectIconRaster source={source} style={style} fallback={fallback} />;
}
