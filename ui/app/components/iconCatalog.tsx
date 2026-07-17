import React from "react";
import * as StratoIcons from "@dynatrace/strato-icons";
import { useMapSettings } from "./mapSettings";
import type { BrandIconStyle } from "./mapSettings";
import { useT } from "../i18n";
import {
  siGooglecloud,
  siGooglebigquery,
  siGoogle,
  siCloudflare,
  siCloudflareworkers,
  siServerless,
  siVercel,
  siNetlify,
  siDigitalocean,
  siOpenstack,
  siVmware,
  siFirebase,
  siAlibabacloud,
  siRender,
  siRailway,
  siFastly,
  siAkamai,
  siDocker,
  siKubernetes,
  siPodman,
  siHelm,
  siRancher,
  siContainerd,
  siIstio,
  siArgo,
  siNomad,
  siPostgresql,
  siMysql,
  siMongodb,
  siRedis,
  siMariadb,
  siSqlite,
  siApachecassandra,
  siCouchbase,
  siNeo4j,
  siInfluxdb,
  siCockroachlabs,
  siSnowflake,
  siDatabricks,
  siClickhouse,
  siSupabase,
  siPlanetscale,
  siPrisma,
  siApachekafka,
  siRabbitmq,
  siApachepulsar,
  siNatsdotio,
  siMqtt,
  siCelery,
  siApacheflink,
  siApachespark,
  siApachehadoop,
  siApacheairflow,
  siGithub,
  siGitlab,
  siBitbucket,
  siJenkins,
  siGithubactions,
  siCircleci,
  siAnsible,
  siTerraform,
  siPulumi,
  siHashicorp,
  siConsul,
  siVault,
  siPacker,
  siGitea,
  siJfrog,
  siPrometheus,
  siOpentelemetry,
  siFluentd,
  siNginx,
  siApache,
  siApachetomcat,
  siTraefikproxy,
  siEnvoyproxy,
  siCaddy,
  siApachemaven,
  siNodedotjs,
  siPython,
  siGo,
  siOpenjdk,
  siRust,
  siDotnet,
  siPhp,
  siRuby,
  siSpring,
  siQuarkus,
  siKotlin,
  siScala,
  siTypescript,
  siJavascript,
  siGraphql,
  siOpenapiinitiative,
  siLinux,
  siUbuntu,
  siDebian,
  siRedhat,
  siAlpinelinux,
  siGnubash,
  siCentos,
  siSuse,
} from "simple-icons";

// Catálogo unificado de íconos para los nodos:
//  - "glyph": trazos propios (compatibilidad con mapas ya guardados).
//  - "brand": logos de marca (simple-icons + marcas dibujadas a mano que
//    simple-icons removió por política: AWS, Azure, Oracle, IBM). Responden al
//    ajuste color/monocromo del mapa.
//  - "strato": íconos nativos de Dynatrace (@dynatrace/strato-icons), siempre
//    en color del tema (currentColor).
// El nodo guarda solo el `id` del ícono; el render se resuelve aquí.

type SiIcon = { title: string; slug: string; path: string; hex: string };

type StratoEntry = {
  id: string;
  label: string;
  // Clave i18n opcional para traducir la etiqueta visible/accesible. Si falta,
  // se usa `label` crudo (caso de las marcas: nombres propios, no se traducen).
  labelKey?: string;
  cat: string;
  kind: "strato";
  Comp: React.ComponentType<{ size?: number }>;
};
type BrandEntry = {
  id: string;
  label: string;
  // Clave i18n opcional para traducir la etiqueta visible/accesible. Si falta,
  // se usa `label` crudo (caso de las marcas: nombres propios, no se traducen).
  labelKey?: string;
  cat: string;
  kind: "brand";
  hex: string;
  draw: (fill: string) => React.ReactNode;
};
type GlyphEntry = {
  id: string;
  label: string;
  // Clave i18n opcional para traducir la etiqueta visible/accesible. Si falta,
  // se usa `label` crudo (caso de las marcas: nombres propios, no se traducen).
  labelKey?: string;
  cat: string;
  kind: "glyph";
  draw: () => React.ReactNode;
};
export type IconEntry = StratoEntry | BrandEntry | GlyphEntry;

// Helper para entradas de simple-icons (un único path con su color de marca).
const b = (id: string, label: string, cat: string, ic: SiIcon): BrandEntry => ({
  id,
  label,
  cat,
  kind: "brand",
  hex: ic.hex,
  draw: (fill) => <path d={ic.path} fill={fill} />,
});

// Glifos básicos heredados (ids tal cual los guardan los mapas existentes).
const legacyGlyphs: GlyphEntry[] = [
  { id: "search", label: "Búsqueda", labelKey: "icon.search", cat: "Básicos", kind: "glyph", draw: () => (<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>) },
  { id: "swap", label: "Transferencia", labelKey: "icon.swap", cat: "Básicos", kind: "glyph", draw: () => (<><path d="M4 8h13M14 5l3 3-3 3" /><path d="M20 16H7M10 13l-3 3 3 3" /></>) },
  { id: "lock", label: "Candado", labelKey: "icon.lock", cat: "Básicos", kind: "glyph", draw: () => (<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>) },
  { id: "db", label: "Base de datos", labelKey: "icon.db", cat: "Básicos", kind: "glyph", draw: () => (<><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>) },
  { id: "box", label: "Paquete", labelKey: "icon.box", cat: "Básicos", kind: "glyph", draw: () => (<><path d="M12 2.5 21 7.3v9.4l-9 4.8-9-4.8V7.3z" /><path d="M3.4 7.5 12 12.1l8.6-4.6M12 12.1v9" /></>) },
  { id: "shield", label: "Escudo", labelKey: "icon.shield", cat: "Básicos", kind: "glyph", draw: () => (<><path d="M12 2.5 20 5.5v6c0 5-3.5 8.2-8 10-4.5-1.8-8-5-8-10v-6z" /><path d="M8.8 12l2.2 2.2 4.2-4.4" /></>) },
];

// Marcas que simple-icons removió por política de logos → dibujadas a mano,
// con su color de marca (responden al toggle color/monocromo como las demás).
const customBrands: BrandEntry[] = [
  { id: "aws", label: "AWS", cat: "Nube", kind: "brand", hex: "FF9900", draw: (f) => (<g fill="none" stroke={f} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 13.4c3.7 2.7 13.3 2.7 17 0" /><path d="M16.8 12.1l3.7 1.1-1 3.8" /></g>) },
  { id: "azure", label: "Azure", cat: "Nube", kind: "brand", hex: "0078D4", draw: (f) => <path fill={f} fillRule="evenodd" d="M12 3.5 21 20.5 3 20.5Z M12 9.8 8.2 17 15.8 17Z" /> },
  { id: "oracle", label: "Oracle", cat: "Nube", kind: "brand", hex: "C74634", draw: (f) => <rect x={3} y={8} width={18} height={8} rx={4} fill="none" stroke={f} strokeWidth={2.1} /> },
  { id: "ibm", label: "IBM", cat: "Nube", kind: "brand", hex: "1F70C1", draw: (f) => (<g stroke={f} strokeWidth={1.6}><line x1={4.5} y1={6} x2={19.5} y2={6} /><line x1={4.5} y1={9} x2={19.5} y2={9} /><line x1={4.5} y1={12} x2={19.5} y2={12} /><line x1={4.5} y1={15} x2={19.5} y2={15} /><line x1={4.5} y1={18} x2={19.5} y2={18} /></g>) },
  // Servicios AWS/seguridad/red que simple-icons NO trae (los retiró por política
  // de logos): dibujados a mano, con el color del servicio. Responden al toggle
  // color/monocromo igual que el resto.
  { id: "route53", label: "Amazon Route 53", cat: "Nube", kind: "brand", hex: "8C4FFF", draw: (f) => (<g fill="none" stroke={f} strokeWidth={1.7} strokeLinecap="round"><circle cx={12} cy={12} r={8.4} /><ellipse cx={12} cy={12} rx={3.5} ry={8.4} /><path d="M3.6 12h16.8M4 9.2h16M4 14.8h16" /></g>) },
  { id: "s3", label: "Amazon S3", cat: "Nube", kind: "brand", hex: "569A31", draw: (f) => (<g fill="none" stroke={f} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><ellipse cx={12} cy={6.4} rx={6.6} ry={2.3} /><path d="M5.4 6.4l1.4 12.3a1.2 1.2 0 0 0 1.2 1.05h8a1.2 1.2 0 0 0 1.2-1.05L18.6 6.4" /></g>) },
  { id: "eks", label: "Amazon EKS", cat: "Contenedores", kind: "brand", hex: "ED7100", draw: (f) => (<g fill="none" stroke={f} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.8l7.4 4.25v8.9L12 20.2 4.6 15.95v-8.9z" /><circle cx={12} cy={11.5} r={2.6} /><path d="M12 4.6v2.3M12 16.1v2.3M6.5 8.3l2 1.2M15.5 13.5l2 1.2M17.5 8.3l-2 1.2M8.5 13.5l-2 1.2" /></g>) },
  { id: "istio-ingress", label: "Istio Ingress", cat: "Contenedores", kind: "brand", hex: "466BB0", draw: (f) => (<g fill="none" stroke={f} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 3.8H18a1.2 1.2 0 0 1 1.2 1.2v14a1.2 1.2 0 0 1-1.2 1.2h-4.5" /><path d="M3.6 12h9.2M9 8.2l3.8 3.8L9 15.8" /></g>) },
  { id: "awswaf", label: "AWS WAF", cat: "Seguridad", kind: "brand", hex: "DD344C", draw: (f) => (<g fill="none" stroke={f} strokeWidth={1.5} strokeLinejoin="round"><rect x={3.4} y={5.2} width={17.2} height={13.6} rx={1.4} /><path d="M3.4 9.7h17.2M3.4 14.3h17.2M9 5.2v4.5M15 5.2v4.5M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3v4.5M15 14.3v4.5" /></g>) },
  { id: "imperva", label: "Imperva WAF", cat: "Seguridad", kind: "brand", hex: "F5A623", draw: (f) => (<g fill="none" stroke={f} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.6l8 2.9v6c0 5-3.5 8.2-8 10-4.5-1.8-8-5-8-10v-6z" /><path d="M8.7 11.6l2.4 2.4 4.4-4.7" /></g>) },
];

// Logos de marca de simple-icons (verificados existentes en v16).
const brandIcons: BrandEntry[] = [
  b("si:googlecloud", "Google Cloud", "Nube", siGooglecloud),
  b("si:googlebigquery", "Google BigQuery", "Nube", siGooglebigquery),
  b("si:google", "Google", "Nube", siGoogle),
  b("si:cloudflare", "Cloudflare", "Nube", siCloudflare),
  b("si:cloudflareworkers", "Cloudflare Workers", "Nube", siCloudflareworkers),
  b("si:serverless", "Serverless", "Nube", siServerless),
  b("si:vercel", "Vercel", "Nube", siVercel),
  b("si:netlify", "Netlify", "Nube", siNetlify),
  b("si:digitalocean", "DigitalOcean", "Nube", siDigitalocean),
  b("si:openstack", "OpenStack", "Nube", siOpenstack),
  b("si:vmware", "VMware", "Nube", siVmware),
  b("si:firebase", "Firebase", "Nube", siFirebase),
  b("si:alibabacloud", "Alibaba Cloud", "Nube", siAlibabacloud),
  b("si:render", "Render", "Nube", siRender),
  b("si:railway", "Railway", "Nube", siRailway),
  b("si:fastly", "Fastly", "Nube", siFastly),
  b("si:akamai", "Akamai", "Nube", siAkamai),
  b("si:docker", "Docker", "Contenedores", siDocker),
  b("si:kubernetes", "Kubernetes", "Contenedores", siKubernetes),
  b("si:podman", "Podman", "Contenedores", siPodman),
  b("si:helm", "Helm", "Contenedores", siHelm),
  b("si:rancher", "Rancher", "Contenedores", siRancher),
  b("si:containerd", "containerd", "Contenedores", siContainerd),
  b("si:istio", "Istio", "Contenedores", siIstio),
  b("si:argo", "Argo", "Contenedores", siArgo),
  b("si:nomad", "Nomad", "Contenedores", siNomad),
  b("si:postgresql", "PostgreSQL", "Bases de datos", siPostgresql),
  b("si:mysql", "MySQL", "Bases de datos", siMysql),
  b("si:mongodb", "MongoDB", "Bases de datos", siMongodb),
  b("si:redis", "Redis", "Bases de datos", siRedis),
  b("si:mariadb", "MariaDB", "Bases de datos", siMariadb),
  b("si:sqlite", "SQLite", "Bases de datos", siSqlite),
  b("si:apachecassandra", "Apache Cassandra", "Bases de datos", siApachecassandra),
  b("si:couchbase", "Couchbase", "Bases de datos", siCouchbase),
  b("si:neo4j", "Neo4j", "Bases de datos", siNeo4j),
  b("si:influxdb", "InfluxDB", "Bases de datos", siInfluxdb),
  b("si:cockroachlabs", "Cockroach Labs", "Bases de datos", siCockroachlabs),
  b("si:snowflake", "Snowflake", "Bases de datos", siSnowflake),
  b("si:databricks", "Databricks", "Bases de datos", siDatabricks),
  b("si:clickhouse", "ClickHouse", "Bases de datos", siClickhouse),
  b("si:supabase", "Supabase", "Bases de datos", siSupabase),
  b("si:planetscale", "PlanetScale", "Bases de datos", siPlanetscale),
  b("si:prisma", "Prisma", "Bases de datos", siPrisma),
  b("si:apachekafka", "Apache Kafka", "Mensajería", siApachekafka),
  b("si:rabbitmq", "RabbitMQ", "Mensajería", siRabbitmq),
  b("si:apachepulsar", "Apache Pulsar", "Mensajería", siApachepulsar),
  b("si:natsdotio", "NATS.io", "Mensajería", siNatsdotio),
  b("si:mqtt", "MQTT", "Mensajería", siMqtt),
  b("si:celery", "Celery", "Mensajería", siCelery),
  b("si:apacheflink", "Apache Flink", "Mensajería", siApacheflink),
  b("si:apachespark", "Apache Spark", "Mensajería", siApachespark),
  b("si:apachehadoop", "Apache Hadoop", "Mensajería", siApachehadoop),
  b("si:apacheairflow", "Apache Airflow", "Mensajería", siApacheairflow),
  b("si:github", "GitHub", "DevOps", siGithub),
  b("si:gitlab", "GitLab", "DevOps", siGitlab),
  b("si:bitbucket", "Bitbucket", "DevOps", siBitbucket),
  b("si:jenkins", "Jenkins", "DevOps", siJenkins),
  b("si:githubactions", "GitHub Actions", "DevOps", siGithubactions),
  b("si:circleci", "CircleCI", "DevOps", siCircleci),
  b("si:ansible", "Ansible", "DevOps", siAnsible),
  b("si:terraform", "Terraform", "DevOps", siTerraform),
  b("si:pulumi", "Pulumi", "DevOps", siPulumi),
  b("si:hashicorp", "HashiCorp", "DevOps", siHashicorp),
  b("si:consul", "Consul", "DevOps", siConsul),
  b("si:vault", "Vault", "DevOps", siVault),
  b("si:packer", "Packer", "DevOps", siPacker),
  b("si:gitea", "Gitea", "DevOps", siGitea),
  b("si:jfrog", "JFrog", "DevOps", siJfrog),
  b("si:prometheus", "Prometheus", "Telemetría", siPrometheus),
  b("si:opentelemetry", "OpenTelemetry", "Telemetría", siOpentelemetry),
  b("si:fluentd", "Fluentd", "Telemetría", siFluentd),
  b("si:nginx", "NGINX", "Servidores web", siNginx),
  b("si:apache", "Apache", "Servidores web", siApache),
  b("si:apachetomcat", "Apache Tomcat", "Servidores web", siApachetomcat),
  b("si:traefikproxy", "Traefik Proxy", "Servidores web", siTraefikproxy),
  b("si:envoyproxy", "Envoy Proxy", "Servidores web", siEnvoyproxy),
  b("si:caddy", "Caddy", "Servidores web", siCaddy),
  b("si:apachemaven", "Apache Maven", "Servidores web", siApachemaven),
  b("si:nodedotjs", "Node.js", "Lenguajes", siNodedotjs),
  b("si:python", "Python", "Lenguajes", siPython),
  b("si:go", "Go", "Lenguajes", siGo),
  b("si:openjdk", "OpenJDK", "Lenguajes", siOpenjdk),
  b("si:rust", "Rust", "Lenguajes", siRust),
  b("si:dotnet", ".NET", "Lenguajes", siDotnet),
  b("si:php", "PHP", "Lenguajes", siPhp),
  b("si:ruby", "Ruby", "Lenguajes", siRuby),
  b("si:spring", "Spring", "Lenguajes", siSpring),
  b("si:quarkus", "Quarkus", "Lenguajes", siQuarkus),
  b("si:kotlin", "Kotlin", "Lenguajes", siKotlin),
  b("si:scala", "Scala", "Lenguajes", siScala),
  b("si:typescript", "TypeScript", "Lenguajes", siTypescript),
  b("si:javascript", "JavaScript", "Lenguajes", siJavascript),
  b("si:graphql", "GraphQL", "Lenguajes", siGraphql),
  b("si:openapiinitiative", "OpenAPI Initiative", "Lenguajes", siOpenapiinitiative),
  b("si:linux", "Linux", "Sistemas", siLinux),
  b("si:ubuntu", "Ubuntu", "Sistemas", siUbuntu),
  b("si:debian", "Debian", "Sistemas", siDebian),
  b("si:redhat", "Red Hat", "Sistemas", siRedhat),
  b("si:alpinelinux", "Alpine Linux", "Sistemas", siAlpinelinux),
  b("si:gnubash", "GNU Bash", "Sistemas", siGnubash),
  b("si:centos", "CentOS", "Sistemas", siCentos),
  b("si:suse", "SUSE", "Sistemas", siSuse),
];

// Íconos nativos de Dynatrace: se toman todos los exportados que terminan en
// "Icon" (excepto el contenedor base SvgIcon).
const stratoIcons: StratoEntry[] = Object.entries(StratoIcons as Record<string, unknown>)
  .filter(([name, val]) => name.endsWith("Icon") && name !== "SvgIcon" && val != null)
  .map(([name, val]) => ({
    id: `dt:${name}`,
    label: name.replace(/Icon$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
    cat: "Dynatrace",
    kind: "strato",
    Comp: val as React.ComponentType<{ size?: number }>,
  }));

export const ICONS: IconEntry[] = [
  ...legacyGlyphs,
  ...customBrands,
  ...brandIcons,
  ...stratoIcons,
];

// PROTOTIPO NULO: con un objeto plano, un `data.icon` malicioso/corrupto tipo
// "constructor" o "toString" devolvía el miembro HEREDADO de Object.prototype
// (truthy) → esquivaba el fallback `??` y `entry.draw()` reventaba el render de
// toda la app (sin ErrorBoundary + "último mapa abierto" = crash en bucle).
export const ICON_BY_ID: Record<string, IconEntry> = Object.assign(
  Object.create(null) as Record<string, IconEntry>,
  Object.fromEntries(ICONS.map((i) => [i.id, i])),
);

export const DEFAULT_ICON_ID = "shield";

// Orden de las categorías en el selector ("Todos" primero y por defecto;
// Dynatrace al final). Sin observabilidad de la competencia (Datadog, Grafana…).
export const ALL_CATEGORY = "Todos";
export const ICON_CATEGORIES = [
  ALL_CATEGORY,
  "Dynatrace",
  "Básicos",
  "Nube",
  "Contenedores",
  "Bases de datos",
  "Mensajería",
  "Telemetría",
  "DevOps",
  "Servidores web",
  "Seguridad",
  "Lenguajes",
  "Sistemas",
];

export const useCategoryLabel = () => {
  const t = useT();
  const MAP: Record<string, string> = {
    "Todos": t("cat.all"),
    "Dynatrace": t("cat.dynatrace"),
    "Básicos": t("cat.basics"),
    "Nube": t("cat.cloud"),
    "Contenedores": t("cat.containers"),
    "Bases de datos": t("cat.databases"),
    "Mensajería": t("cat.messaging"),
    "Telemetría": t("cat.telemetry"),
    "DevOps": t("cat.devops"),
    "Servidores web": t("cat.webservers"),
    "Seguridad": t("cat.security"),
    "Lenguajes": t("cat.languages"),
    "Sistemas": t("cat.systems"),
  };
  return (cat: string) => MAP[cat] ?? cat;
};

export const iconsByCategory = (cat: string): IconEntry[] =>
  cat === ALL_CATEGORY ? ICONS : ICONS.filter((i) => i.cat === cat);

export const searchIcons = (query: string): IconEntry[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ICONS.filter(
    (i) =>
      i.label.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q) ||
      i.cat.toLowerCase().includes(q),
  );
};

// Render unificado. `colorMode` permite forzar color/mono (p. ej. en una vista
// previa); si se omite, usa el ajuste del mapa por contexto.
export const AppIcon = ({
  id,
  size = 18,
  colorMode,
}: {
  id?: string;
  size?: number;
  colorMode?: BrandIconStyle;
}) => {
  const settings = useMapSettings();
  const t = useT();
  const entry = ICON_BY_ID[id ?? DEFAULT_ICON_ID] ?? ICON_BY_ID[DEFAULT_ICON_ID];
  if (!entry) return null;
  // Etiqueta localizada si la entrada trae labelKey (básicos); si no, el label crudo.
  const label = entry.labelKey ? t(entry.labelKey) : entry.label;

  if (entry.kind === "strato") {
    const Comp = entry.Comp;
    return <Comp size={size} />;
  }
  if (entry.kind === "brand") {
    const mode = colorMode ?? settings.brandIconStyle;
    const fill = mode === "color" ? `#${entry.hex}` : "currentColor";
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label}>
        <title>{label}</title>
        {entry.draw(fill)}
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {entry.draw()}
    </svg>
  );
};
