"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { type LucideIcon, Bold, CheckCircle2, Copy, Download, FileText, ImageIcon, Italic, Megaphone, Pin, PlayCircle, Plus, RefreshCw, ShieldCheck, Star, Trash2, Upload, UsersRound } from "lucide-react";
import { TopActions } from "@/components/layout/app-shell";
import { EmptyState, PageHeader, Panel, ProgressLine, StatusBadge } from "@/components/ui/primitives";
import { cn, initials } from "@/lib/utils";
import { FormInput, FormSelect, InfoLine, SystemSettings, apiJson, downloadFile, normalizePerformanceSheetName, queryParam } from './shared';
type MuralPostClient = {
  id: string;
  title: string;
  content: string;
  contentType: string;
  imageUrl?: string;
  mediaUrl?: string;
  externalUrl?: string;
  attachmentUrl?: string;
  targetRoles: string[];
  targetLobIds: string[];
  authorName: string;
  authorEmail?: string;
  authorRole: string;
  status: string;
  priority: string;
  isPinned: boolean;
  requiresRead?: boolean;
  requiresAcknowledgement?: boolean;
  acknowledgedByViewer?: boolean;
  viewerAcknowledgedAt?: string;
  acknowledgementStatus?: string;
  acknowledgementSummary?: null | {
    eligible: number;
    acknowledged: number;
    pending: number;
    adherence: number | null;
  };
  publishAt: string;
  expiresAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
};


type MuralBirthdayClient = {
  employeeId: string;
  name: string;
  lob: string;
  day: number;
  month: number;
  dateLabel: string;
  isToday: boolean;
};


type MuralBirthdaysPayload = {
  today: MuralBirthdayClient[];
  month: MuralBirthdayClient[];
};


type MuralPostFormState = {
  title: string;
  content: string;
  contentType: string;
  imageUrl: string;
  mediaUrl: string;
  externalUrl: string;
  attachmentUrl: string;
  targetRoles: string[];
  targetLobIds: string[];
  priority: string;
  isPinned: boolean;
  requiresAcknowledgement: boolean;
  status: string;
  expiresAt: string;
};


type MuralAcknowledgementRow = {
  userId: string;
  employeeId: string;
  name: string;
  wbLogin: string;
  email: string;
  role: string;
  lobId: string;
  lob: string;
  supervisorId: string;
  supervisor: string;
  status: string;
  acknowledgedAt: string;
};


type MuralAcknowledgementPayload = {
  post: {
    id: string;
    title: string;
    createdAt: string;
    targetRoles: string[];
    targetLobIds: string[];
  };
  targetLobs: string[];
  summary: {
    eligible: number;
    acknowledged: number;
    pending: number;
    adherence: number | null;
  };
  data: MuralAcknowledgementRow[];
  canManage: boolean;
};


const muralTargetRoles = [
  { value: "TODOS", label: "Todos" },
  { value: "AGENTES", label: "Agentes" },
  { value: "SUPERVISORES", label: "Supervisores" },
  { value: "ADMINISTRADORES", label: "Administradores" },
  { value: "WFM", label: "WFM" },
  { value: "RH", label: "RH" },
  { value: "GESTAO", label: "Gestão" },
  { value: "CLIENT", label: "Client" }
];


const muralContentTypes = ["Texto simples", "Texto com link", "Imagem", "Vídeo", "Anexo", "Comunicado fixado", "Novidade do sistema", "Campanha interna"];


function emptyMuralPostForm(): MuralPostFormState {
  return {
    title: "",
    content: "",
    contentType: "Texto simples",
    imageUrl: "",
    mediaUrl: "",
    externalUrl: "",
    attachmentUrl: "",
    targetRoles: ["TODOS"],
    targetLobIds: [],
    priority: "MEDIA",
    isPinned: false,
    requiresAcknowledgement: false,
    status: "PUBLICADO",
    expiresAt: ""
  };
}


function muralPriorityLabel(priority: string) {
  const labels: Record<string, string> = {
    BAIXA: "Baixa",
    MEDIA: "Média",
    ALTA: "Alta",
    CRITICA: "Crítica"
  };
  return labels[priority] ?? priority;
}


function muralContentIcon(type: string) {
  const normalized = normalizePerformanceSheetName(type);
  if (normalized.includes("video")) return PlayCircle;
  if (normalized.includes("imagem")) return ImageIcon;
  if (normalized.includes("anexo")) return FileText;
  if (normalized.includes("campanha")) return Star;
  if (normalized.includes("sistema")) return ShieldCheck;
  if (normalized.includes("link")) return Copy;
  if (normalized.includes("fixado")) return Pin;
  return Megaphone;
}


function muralVisualTheme(type: string) {
  const normalized = normalizePerformanceSheetName(type);
  if (normalized.includes("video")) return "from-indigo-950 via-blue-800 to-violet-500";
  if (normalized.includes("imagem")) return "from-sky-950 via-blue-700 to-cyan-400";
  if (normalized.includes("anexo")) return "from-slate-950 via-slate-700 to-blue-400";
  if (normalized.includes("campanha")) return "from-blue-950 via-indigo-700 to-amber-400";
  if (normalized.includes("sistema")) return "from-emerald-950 via-blue-800 to-emerald-400";
  if (normalized.includes("link")) return "from-navy-950 via-blue-700 to-sky-400";
  if (normalized.includes("fixado")) return "from-blue-950 via-blue-700 to-violet-400";
  return "from-navy-950 via-blue-800 to-cyan-500";
}


function muralAudienceLabel(roles: string[]) {
  if (!roles.length || roles.includes("TODOS")) return "Todos";
  const labels = new Map(muralTargetRoles.map((role) => [role.value, role.label]));
  return roles.map((role) => labels.get(role) ?? role).join(", ");
}


function stripMuralMarkdown(value: string) {
  return value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").trim();
}


type MuralMarkdownPart = {
  text: string;
  style: "normal" | "bold" | "italic";
};


function findClosingSingleAsterisk(value: string, start: number) {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "*" && value[index - 1] !== "*" && value[index + 1] !== "*") return index;
  }
  return -1;
}


function parseMuralMarkdown(value: string): MuralMarkdownPart[] {
  const parts: MuralMarkdownPart[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const boldStart = value.indexOf("**", cursor);
    let italicStart = value.indexOf("*", cursor);
    while (italicStart !== -1 && value[italicStart + 1] === "*") {
      italicStart = value.indexOf("*", italicStart + 2);
    }

    const candidates = [boldStart, italicStart].filter((index) => index >= 0);
    if (!candidates.length) {
      parts.push({ text: value.slice(cursor), style: "normal" });
      break;
    }

    const nextStart = Math.min(...candidates);
    if (nextStart > cursor) parts.push({ text: value.slice(cursor, nextStart), style: "normal" });

    if (nextStart === boldStart) {
      const end = value.indexOf("**", nextStart + 2);
      if (end === -1) {
        parts.push({ text: value.slice(nextStart), style: "normal" });
        break;
      }
      parts.push({ text: value.slice(nextStart + 2, end), style: "bold" });
      cursor = end + 2;
    } else {
      const end = findClosingSingleAsterisk(value, nextStart + 1);
      if (end === -1) {
        parts.push({ text: value.slice(nextStart), style: "normal" });
        break;
      }
      parts.push({ text: value.slice(nextStart + 1, end), style: "italic" });
      cursor = end + 1;
    }
  }

  return parts.filter((part) => part.text.length > 0);
}


function MuralFormattedText({ content, className }: { content: string; className?: string }) {
  return (
    <span className={cn("whitespace-pre-line", className)}>
      {parseMuralMarkdown(content).map((part, index) => {
        if (part.style === "bold") return <strong key={`${part.style}-${index}`} className="font-extrabold text-navy-950">{part.text}</strong>;
        if (part.style === "italic") return <em key={`${part.style}-${index}`} className="italic">{part.text}</em>;
        return <span key={`${part.style}-${index}`}>{part.text}</span>;
      })}
    </span>
  );
}


function muralFormToPreview(form: MuralPostFormState): MuralPostClient {
  const now = new Date().toISOString();
  return {
    id: "preview",
    title: form.title || "Título do aviso",
    content: form.content || "Resumo do comunicado aparecerá aqui.",
    contentType: form.contentType,
    imageUrl: form.imageUrl,
    mediaUrl: form.mediaUrl,
    externalUrl: form.externalUrl,
    attachmentUrl: form.attachmentUrl,
    targetRoles: form.targetRoles,
    targetLobIds: form.targetLobIds,
    authorName: "Preview",
    authorRole: "ADMIN",
    status: form.status,
    priority: form.priority,
    isPinned: form.isPinned,
    requiresAcknowledgement: form.requiresAcknowledgement,
    acknowledgedByViewer: false,
    viewerAcknowledgedAt: "",
    acknowledgementStatus: form.requiresAcknowledgement ? "Pendente de ciência" : "Não exige ciência",
    acknowledgementSummary: null,
    publishAt: now,
    expiresAt: form.expiresAt,
    createdAt: now,
    updatedAt: now,
    canManage: true
  };
}


function formatDateTimeShort(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo"
  });
}


function MuralPostVisual({ post, large = false }: { post: Pick<MuralPostClient, "title" | "contentType" | "imageUrl">; large?: boolean }) {
  const Icon = muralContentIcon(post.contentType);
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(post.imageUrl?.trim()) && !imageFailed;
  const placeholderGradient = muralVisualTheme(post.contentType);

  useEffect(() => {
    setImageFailed(false);
  }, [post.imageUrl]);

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-blue-950",
        large ? "min-h-[300px]" : "min-h-[210px] md:min-h-full"
      )}
    >
      {hasImage ? (
        <>
          {/* Uploaded covers may use signed or temporary URLs that cannot pass Next Image allowlists. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.imageUrl} alt="" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-br from-navy-950/35 to-blue-700/25" />
        </>
      ) : null}
      {!hasImage ? (
        <div className={cn("absolute inset-0 bg-gradient-to-br", placeholderGradient)} />
      ) : null}
      <div className="relative flex h-full min-h-[inherit] flex-col justify-between p-4 text-white">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/18 px-3 py-1 text-xs font-extrabold backdrop-blur">
          <Icon className="h-4 w-4" />
          {post.contentType}
        </span>
        {!hasImage ? (
          <div className="grid flex-1 place-items-center py-4">
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-white/16 shadow-lg ring-1 ring-white/20 backdrop-blur">
              <Icon className="h-10 w-10" />
            </div>
          </div>
        ) : null}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-blue-100">Mural</p>
          {!hasImage ? (
            <p className="mt-1 line-clamp-2 text-xl font-black">{post.title}</p>
          ) : (
            <p className="mt-1 text-sm font-extrabold text-white/90">Comunicado visual</p>
          )}
        </div>
      </div>
    </div>
  );
}


function MuralHeroCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/14 bg-white/10 p-3 backdrop-blur">
      <Icon className="h-4 w-4 text-blue-100" />
      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-blue-100">{label}</p>
      <p className="mt-1 text-sm font-black text-white">{value}</p>
    </div>
  );
}


function MuralBirthdayItem({ item, compact = false }: { item: MuralBirthdayClient; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-border bg-white p-3", compact && "p-2")}>
      <span className={cn("grid place-items-center rounded-full bg-blue-50 font-black text-blue-700", compact ? "h-9 w-9 text-xs" : "h-10 w-10")}>{initials(item.name)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-extrabold text-navy-950">{item.name}</p>
        <p className="text-xs font-semibold text-muted">{item.lob} • {item.dateLabel}</p>
      </div>
    </div>
  );
}


function MuralAckMetric({ label, value, tone = "blue" }: { label: string; value: ReactNode; tone?: "blue" | "green" | "red" }) {
  const toneClass = tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-600" : "text-blue-700";
  return (
    <div className="rounded-lg border border-border bg-white p-3 text-center">
      <p className={cn("text-lg font-black leading-none", toneClass)}>{value}</p>
      <p className="mt-1 text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}


function applyMarkdownToText(value: string, start: number, end: number, marker: "**" | "*") {
  const fallback = marker === "**" ? "texto em negrito" : "texto em itálico";
  const selected = value.slice(start, end) || fallback;
  const next = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`;
  return {
    next,
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + selected.length
  };
}


type MuralCoverDraft = {
  sourceUrl: string;
  fileName: string;
};


type MuralCoverUploadResponse = {
  data: {
    imageUrl: string;
    fileId: string;
    storagePath: string;
  };
};


const muralCoverOutputWidth = 1200;

const muralCoverOutputHeight = 675;

const muralCoverMaxBytes = 5 * 1024 * 1024;

const muralCoverMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);


function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}


function safeMuralCoverFileName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_") || "mural-cover";
  return `${base}-${Date.now()}.jpg`;
}


async function buildCroppedMuralCoverFile(image: HTMLImageElement, fileName: string, crop: { x: number; y: number; zoom: number }) {
  const canvas = document.createElement("canvas");
  canvas.width = muralCoverOutputWidth;
  canvas.height = muralCoverOutputHeight;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar o recorte da imagem.");

  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  const targetRatio = muralCoverOutputWidth / muralCoverOutputHeight;
  const sourceRatio = naturalWidth / naturalHeight;
  const zoom = clampNumber(crop.zoom, 1, 2.5);

  let cropWidth: number;
  let cropHeight: number;
  if (sourceRatio > targetRatio) {
    cropHeight = naturalHeight / zoom;
    cropWidth = cropHeight * targetRatio;
  } else {
    cropWidth = naturalWidth / zoom;
    cropHeight = cropWidth / targetRatio;
  }

  const centerX = (clampNumber(crop.x, 0, 100) / 100) * naturalWidth;
  const centerY = (clampNumber(crop.y, 0, 100) / 100) * naturalHeight;
  const sourceX = clampNumber(centerX - cropWidth / 2, 0, naturalWidth - cropWidth);
  const sourceY = clampNumber(centerY - cropHeight / 2, 0, naturalHeight - cropHeight);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, muralCoverOutputWidth, muralCoverOutputHeight);
  context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, muralCoverOutputWidth, muralCoverOutputHeight);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Não foi possível gerar a imagem recortada.");
  return new File([blob], safeMuralCoverFileName(fileName), { type: "image/jpeg" });
}


export function MuralPage() {
  const [posts, setPosts] = useState<MuralPostClient[]>([]);
  const [birthdays, setBirthdays] = useState<MuralBirthdaysPayload>({ today: [], month: [] });
  const [muralLoading, setMuralLoading] = useState(true);
  const [muralMessage, setMuralMessage] = useState("");
  const [canManageMural, setCanManageMural] = useState(false);
  const [selectedPost, setSelectedPost] = useState<MuralPostClient | null>(null);
  const [editingPost, setEditingPost] = useState<MuralPostClient | null>(null);
  const [muralFormOpen, setMuralFormOpen] = useState(false);
  const [muralForm, setMuralForm] = useState<MuralPostFormState>(() => emptyMuralPostForm());
  const [muralLobs, setMuralLobs] = useState<Array<{ id: string; name: string }>>([]);
  const [savingMuralPost, setSavingMuralPost] = useState(false);
  const [deletingMuralPostId, setDeletingMuralPostId] = useState("");
  const [muralFilters, setMuralFilters] = useState({ q: "", status: "Todos", priority: "Todos", contentType: "Todos", lobId: "Todos" });
  const [muralCoverDraft, setMuralCoverDraft] = useState<MuralCoverDraft | null>(null);
  const [muralCoverCrop, setMuralCoverCrop] = useState({ x: 50, y: 50, zoom: 1 });
  const [muralCoverError, setMuralCoverError] = useState("");
  const [uploadingMuralCover, setUploadingMuralCover] = useState(false);
  const [acknowledgePost, setAcknowledgePost] = useState<MuralPostClient | null>(null);
  const [acknowledgingPost, setAcknowledgingPost] = useState(false);
  const [acknowledgementLoading, setAcknowledgementLoading] = useState(false);
  const [acknowledgementPanel, setAcknowledgementPanel] = useState<MuralAcknowledgementPayload | null>(null);
  const [acknowledgementFilters, setAcknowledgementFilters] = useState({ status: "Todos", lobId: "Todos", role: "Todos", supervisorId: "Todos", q: "" });
  const muralCoverInputRef = useRef<HTMLInputElement | null>(null);
  const muralCoverImageRef = useRef<HTMLImageElement | null>(null);
  const muralContentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const openedMuralPostFromUrl = useRef(false);
  const muralPostIdFromUrl = queryParam("postId");

  useEffect(() => {
    void loadMural();
    apiJson<{ data: SystemSettings }>("/api/settings")
      .then((payload) => setMuralLobs(payload.data.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => ({ id: lob.id, name: lob.name }))))
      .catch(() => setMuralLobs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMural() {
    setMuralLoading(true);
    try {
      const params = new URLSearchParams();
      if (muralFilters.q.trim()) params.set("q", muralFilters.q.trim());
      if (muralFilters.priority !== "Todos") params.set("priority", muralFilters.priority);
      if (muralFilters.contentType !== "Todos") params.set("contentType", muralFilters.contentType);
      if (muralFilters.lobId !== "Todos") params.set("lobId", muralFilters.lobId);
      if (canManageMural && muralFilters.status !== "Todos") params.set("status", muralFilters.status);
      const [postsPayload, birthdayPayload] = await Promise.all([
        apiJson<{ data: MuralPostClient[]; canManage: boolean }>(`/api/mural/posts${params.toString() ? `?${params.toString()}` : ""}`),
        apiJson<{ data: MuralBirthdaysPayload; canManage: boolean }>("/api/mural/birthdays")
      ]);
      setPosts(postsPayload.data);
      setBirthdays(birthdayPayload.data);
      setCanManageMural(postsPayload.canManage);
      if (muralPostIdFromUrl && !openedMuralPostFromUrl.current) {
        openedMuralPostFromUrl.current = true;
        const postFromList = postsPayload.data.find((post) => post.id === muralPostIdFromUrl);
        if (postFromList) {
          void openMuralPostDetail(postFromList);
        } else {
          void loadMuralPostDetail(muralPostIdFromUrl);
        }
      }
      setMuralMessage("");
    } catch (error) {
      setPosts([]);
      setMuralMessage(error instanceof Error ? error.message : "Não foi possível carregar o mural. Tente novamente.");
    } finally {
      setMuralLoading(false);
    }
  }

  function openNewMuralPost() {
    clearMuralCoverDraft();
    setEditingPost(null);
    setMuralForm(emptyMuralPostForm());
    setMuralFormOpen(true);
  }

  function openEditMuralPost(post: MuralPostClient) {
    clearMuralCoverDraft();
    setEditingPost(post);
    setMuralForm({
      title: post.title,
      content: post.content,
      contentType: post.contentType,
      imageUrl: post.imageUrl ?? "",
      mediaUrl: post.mediaUrl ?? "",
      externalUrl: post.externalUrl ?? "",
      attachmentUrl: post.attachmentUrl ?? "",
      targetRoles: post.targetRoles.length ? post.targetRoles : ["TODOS"],
      targetLobIds: post.targetLobIds,
      priority: post.priority,
      isPinned: post.isPinned,
      requiresAcknowledgement: Boolean(post.requiresAcknowledgement),
      status: post.status,
      expiresAt: post.expiresAt ? post.expiresAt.slice(0, 10) : ""
    });
    setMuralFormOpen(true);
  }

  function clearMuralCoverDraft() {
    setMuralCoverDraft((current) => {
      if (current?.sourceUrl.startsWith("blob:")) URL.revokeObjectURL(current.sourceUrl);
      return null;
    });
    setMuralCoverError("");
    setUploadingMuralCover(false);
  }

  function handleMuralCoverFile(file?: File | null) {
    setMuralCoverError("");
    if (!file) return;
    if (!muralCoverMimeTypes.has(file.type)) {
      setMuralCoverError("Use uma imagem PNG, JPG, JPEG ou WEBP.");
      return;
    }
    if (file.size > muralCoverMaxBytes) {
      setMuralCoverError("Imagem acima do limite de 5 MB.");
      return;
    }
    clearMuralCoverDraft();
    setMuralCoverCrop({ x: 50, y: 50, zoom: 1 });
    setMuralCoverDraft({ sourceUrl: URL.createObjectURL(file), fileName: file.name });
  }

  async function uploadMuralCoverCrop() {
    const image = muralCoverImageRef.current;
    if (!muralCoverDraft || !image) return;
    setUploadingMuralCover(true);
    setMuralCoverError("");
    try {
      const file = await buildCroppedMuralCoverFile(image, muralCoverDraft.fileName, muralCoverCrop);
      const formData = new FormData();
      formData.set("file", file);
      const response = await apiJson<MuralCoverUploadResponse>("/api/mural/uploads/cover", {
        method: "POST",
        body: formData
      });
      setMuralForm((current) => ({ ...current, imageUrl: response.data.imageUrl }));
      clearMuralCoverDraft();
      setMuralMessage("Imagem de capa enviada com sucesso.");
    } catch (error) {
      setMuralCoverError(error instanceof Error ? error.message : "Não foi possível enviar a imagem recortada.");
    } finally {
      setUploadingMuralCover(false);
    }
  }

  async function saveMuralPost() {
    setSavingMuralPost(true);
    try {
      await apiJson(editingPost ? `/api/mural/posts/${editingPost.id}` : "/api/mural/posts", {
        method: editingPost ? "PUT" : "POST",
        body: JSON.stringify(muralForm)
      });
      setMuralFormOpen(false);
      setEditingPost(null);
      await loadMural();
      setMuralMessage(editingPost ? "Aviso atualizado com sucesso." : "Aviso criado com sucesso.");
    } catch (error) {
      setMuralMessage(error instanceof Error ? error.message : "Não foi possível salvar o aviso.");
    } finally {
      setSavingMuralPost(false);
    }
  }

  async function changeMuralPostStatus(post: MuralPostClient, status: string) {
    try {
      await apiJson(`/api/mural/posts/${post.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await loadMural();
      setMuralMessage("Status do aviso atualizado.");
    } catch (error) {
      setMuralMessage(error instanceof Error ? error.message : "Não foi possível atualizar o aviso.");
    }
  }

  async function deleteMuralPostClient(post: MuralPostClient) {
    if (!canManageMural || deletingMuralPostId) return;
    if (!window.confirm(`Excluir o aviso "${post.title}"? Esta ação remove o post do Mural e limpa pendências de leitura relacionadas.`)) return;
    setDeletingMuralPostId(post.id);
    try {
      await apiJson(`/api/mural/posts/${encodeURIComponent(post.id)}`, { method: "DELETE" });
      setSelectedPost((current) => current?.id === post.id ? null : current);
      setEditingPost((current) => current?.id === post.id ? null : current);
      setMuralFormOpen((current) => current && editingPost?.id === post.id ? false : current);
      setAcknowledgePost((current) => current?.id === post.id ? null : current);
      await loadMural();
      setMuralMessage("Aviso excluído do Mural.");
    } catch (error) {
      setMuralMessage(error instanceof Error ? error.message : "Não foi possível excluir o aviso.");
    } finally {
      setDeletingMuralPostId("");
    }
  }

  async function loadMuralPostDetail(postId: string) {
    try {
      const response = await apiJson<{ data: MuralPostClient; canManage: boolean }>(`/api/mural/posts/${encodeURIComponent(postId)}`);
      await openMuralPostDetail(response.data);
    } catch (error) {
      setMuralMessage(error instanceof Error ? error.message : "Não foi possível abrir o comunicado.");
    }
  }

  async function openMuralPostDetail(post: MuralPostClient) {
    setSelectedPost(post);
    setAcknowledgementPanel(null);
    if (post.requiresAcknowledgement && (post.canManage || canManageMural)) {
      await loadMuralAcknowledgements(post.id);
    }
  }

  function muralAcknowledgementParams(overrides: Partial<typeof acknowledgementFilters> = {}) {
    const nextFilters = { ...acknowledgementFilters, ...overrides };
    const params = new URLSearchParams();
    if (nextFilters.status !== "Todos") params.set("status", nextFilters.status);
    if (nextFilters.lobId !== "Todos") params.set("lobId", nextFilters.lobId);
    if (nextFilters.role !== "Todos") params.set("role", nextFilters.role);
    if (nextFilters.supervisorId !== "Todos") params.set("supervisorId", nextFilters.supervisorId);
    if (nextFilters.q.trim()) params.set("q", nextFilters.q.trim());
    return params;
  }

  async function loadMuralAcknowledgements(postId: string, overrides: Partial<typeof acknowledgementFilters> = {}) {
    setAcknowledgementLoading(true);
    try {
      const params = muralAcknowledgementParams(overrides);
      const response = await apiJson<MuralAcknowledgementPayload>(`/api/mural/posts/${encodeURIComponent(postId)}/acknowledgements${params.toString() ? `?${params.toString()}` : ""}`);
      setAcknowledgementPanel(response);
    } catch (error) {
      setMuralMessage(error instanceof Error ? error.message : "Não foi possível carregar aderência de ciência.");
    } finally {
      setAcknowledgementLoading(false);
    }
  }

  async function confirmMuralAcknowledgement() {
    if (!acknowledgePost) return;
    setAcknowledgingPost(true);
    try {
      const response = await apiJson<{ data: MuralPostClient | null; message: string }>(`/api/mural/posts/${encodeURIComponent(acknowledgePost.id)}/acknowledge`, {
        method: "POST"
      });
      if (response.data) {
        setPosts((current) => current.map((post) => post.id === response.data?.id ? response.data : post));
        setSelectedPost((current) => current?.id === response.data?.id ? response.data : current);
      }
      setAcknowledgePost(null);
      setMuralMessage(response.message || "Ciência registrada com sucesso.");
      if (response.data?.requiresAcknowledgement && (response.data.canManage || canManageMural)) {
        await loadMuralAcknowledgements(response.data.id);
      }
    } catch (error) {
      setMuralMessage(error instanceof Error ? error.message : "Não foi possível registrar ciência.");
    } finally {
      setAcknowledgingPost(false);
    }
  }

  function exportMuralAcknowledgements(postId: string) {
    const params = muralAcknowledgementParams();
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return downloadFile(`/api/mural/posts/${encodeURIComponent(postId)}/acknowledgements/export${suffix}`, "aderencia_mural.xlsx", "Não foi possível exportar aderência do Mural.");
  }

  function updateMuralTargetRole(role: string, checked: boolean) {
    setMuralForm((current) => {
      const next = checked ? [...current.targetRoles, role] : current.targetRoles.filter((item) => item !== role);
      return { ...current, targetRoles: role === "TODOS" && checked ? ["TODOS"] : Array.from(new Set(next.filter((item) => item !== "TODOS" || role === "TODOS"))) };
    });
  }

  function updateMuralTargetLob(lobId: string, checked: boolean) {
    setMuralForm((current) => ({ ...current, targetLobIds: checked ? Array.from(new Set([...current.targetLobIds, lobId])) : current.targetLobIds.filter((item) => item !== lobId) }));
  }

  function formatMuralContent(marker: "**" | "*") {
    const textarea = muralContentInputRef.current;
    const start = textarea?.selectionStart ?? muralForm.content.length;
    const end = textarea?.selectionEnd ?? muralForm.content.length;
    const formatted = applyMarkdownToText(muralForm.content, start, end, marker);
    setMuralForm((current) => ({ ...current, content: formatted.next }));
    requestAnimationFrame(() => {
      const input = muralContentInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(formatted.selectionStart, formatted.selectionEnd);
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mural de Avisos"
        description="Fique por dentro dos comunicados, campanhas e novidades."
        icon={Megaphone}
        actions={<div className="flex flex-wrap gap-2">{canManageMural ? <button onClick={openNewMuralPost} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" /> Novo aviso</button> : null}<TopActions /></div>}
      />
      {muralMessage ? <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{muralMessage}</div> : null}
      {muralLoading ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">Carregando mural...</div> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <div className="overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_top_right,rgba(96,165,250,.34),transparent_30%),linear-gradient(135deg,#061a3d,#0b2f73_52%,#0f766e)] text-white shadow-card">
            <div className="grid min-h-[220px] gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
              <div className="max-w-3xl">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/14 px-3 py-1 text-xs font-bold uppercase tracking-wide">
                  <Megaphone className="h-4 w-4" />
                  Canal interno
                </span>
                <h2 className="mt-5 text-3xl font-extrabold">Avisos importantes em um só lugar</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50 md:text-base">Acompanhe comunicados, campanhas, novidades e orientações da operação de forma simples e centralizada.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <MuralHeroCard icon={Megaphone} label="Feed" value="Comunicados recentes" />
                <MuralHeroCard icon={Star} label="Campanhas" value="Destaques internos" />
                <MuralHeroCard icon={UsersRound} label="Públicos" value="Por perfil e LOB" />
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_150px_170px_170px_170px_auto]">
              <input value={muralFilters.q} onChange={(event) => setMuralFilters({ ...muralFilters, q: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Buscar aviso..." />
              {canManageMural ? (
                <select value={muralFilters.status} onChange={(event) => setMuralFilters({ ...muralFilters, status: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">
                  {["Todos", "PUBLICADO", "RASCUNHO", "INATIVO", "ARQUIVADO"].map((item) => <option key={item}>{item}</option>)}
                </select>
              ) : <span className="hidden xl:block" />}
              <select value={muralFilters.priority} onChange={(event) => setMuralFilters({ ...muralFilters, priority: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">
                {["Todos", "BAIXA", "MEDIA", "ALTA", "CRITICA"].map((item) => <option key={item}>{item}</option>)}
              </select>
              <select value={muralFilters.contentType} onChange={(event) => setMuralFilters({ ...muralFilters, contentType: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">
                {["Todos", ...muralContentTypes].map((item) => <option key={item}>{item}</option>)}
              </select>
              <select value={muralFilters.lobId} onChange={(event) => setMuralFilters({ ...muralFilters, lobId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">
                <option value="Todos">Todas as LOBs</option>
                {muralLobs.map((lob) => <option key={lob.id} value={lob.id}>{lob.name}</option>)}
              </select>
              <button type="button" onClick={() => void loadMural()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy-950 px-4 text-sm font-extrabold text-white">
                <RefreshCw className={cn("h-4 w-4", muralLoading && "animate-spin")} /> Filtrar
              </button>
            </div>
          </div>
          <section className="space-y-3">
            <h2 className="text-lg font-extrabold text-navy-950">Comunicados</h2>
            {posts.length ? (
              <div className="space-y-3">
                {posts.map((post) => (
                  <article key={post.id} className={cn("card overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-lg", post.isPinned && "ring-1 ring-blue-200")}>
                    <div className="grid gap-0 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
                      <MuralPostVisual post={post} />
                      <div className="flex min-w-0 flex-col gap-4 p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          {post.isPinned ? <StatusBadge status="Fixado" /> : null}
                          <StatusBadge status={post.contentType} />
                          <StatusBadge status={muralPriorityLabel(post.priority)} />
                          {post.requiresAcknowledgement ? <StatusBadge status="Exige ciência" /> : null}
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-600">{muralAudienceLabel(post.targetRoles)}</span>
                          {canManageMural ? <StatusBadge status={post.status} /> : null}
                          {post.requiresAcknowledgement && !canManageMural ? <StatusBadge status={post.acknowledgementStatus ?? "Pendente"} /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="line-clamp-2 text-xl font-black text-navy-950">{post.title}</h3>
                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{stripMuralMarkdown(post.content)}</p>
                          {post.requiresAcknowledgement && post.acknowledgementSummary && canManageMural ? (
                            <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-extrabold text-blue-900">
                                <span>{post.acknowledgementSummary.acknowledged}/{post.acknowledgementSummary.eligible} cientes</span>
                                <span>{post.acknowledgementSummary.adherence ?? 0}% aderência</span>
                              </div>
                              <ProgressLine label="Aderência de ciência" value={post.acknowledgementSummary.adherence ?? 0} tone="blue" />
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-end justify-between gap-3">
                          <div className="min-w-0 text-xs font-semibold text-muted">
                            <p className="truncate font-extrabold text-navy-950">{post.authorName} • {post.authorRole}</p>
                            <p>{formatDateTimeShort(post.publishAt)}</p>
                          </div>
                          <div className="flex flex-wrap justify-end gap-2">
                            {post.requiresAcknowledgement && !post.acknowledgedByViewer && !canManageMural ? (
                              <button onClick={() => setAcknowledgePost(post)} className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-3 text-xs font-bold text-white">Estou ciente</button>
                            ) : null}
                            <button onClick={() => void openMuralPostDetail(post)} className="inline-flex h-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700">Ver detalhes</button>
                            {canManageMural ? <button onClick={() => openEditMuralPost(post)} className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950">Editar</button> : null}
                            {canManageMural && post.status !== "ARQUIVADO" ? <button onClick={() => void changeMuralPostStatus(post, "ARQUIVADO")} className="inline-flex h-9 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-700">Arquivar</button> : null}
                            {canManageMural ? (
                              <button
                                type="button"
                                disabled={deletingMuralPostId === post.id}
                                onClick={() => void deleteMuralPostClient(post)}
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                {deletingMuralPostId === post.id ? "Excluindo..." : "Excluir"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhum comunicado disponível" description="Quando houver avisos destinados ao seu perfil, eles aparecerão aqui." />
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <Panel title="Aniversariantes de hoje">
            {birthdays.today.length ? birthdays.today.map((item) => (
              <div key={item.employeeId} className="mb-3 last:mb-0">
                <MuralBirthdayItem item={item} />
              </div>
            )) : <EmptyState title="Nenhum aniversariante hoje" description="A lista usa apenas dia e mês da data de nascimento." />}
          </Panel>
          <Panel title="Aniversariantes do mês">
            {birthdays.month.length ? (
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {birthdays.month.map((item) => (
                  <MuralBirthdayItem key={item.employeeId} item={item} compact />
                ))}
              </div>
            ) : <EmptyState title="Nenhum dado de aniversário disponível" description="Quando houver data de nascimento cadastrada, ela aparece aqui sem mostrar o ano." />}
          </Panel>
        </aside>
      </div>

      {selectedPost ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-navy-950/45 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <MuralPostVisual post={selectedPost} large />
            <div className="p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {selectedPost.isPinned ? <StatusBadge status="Fixado" /> : null}
                <StatusBadge status={muralPriorityLabel(selectedPost.priority)} />
                <StatusBadge status={selectedPost.contentType} />
                {selectedPost.requiresAcknowledgement ? <StatusBadge status="Exige ciência" /> : null}
                {selectedPost.requiresAcknowledgement && !canManageMural ? <StatusBadge status={selectedPost.acknowledgementStatus ?? "Pendente"} /> : null}
              </div>
              <h2 className="text-2xl font-black text-navy-950">{selectedPost.title}</h2>
              <div className="mt-3 rounded-xl border border-border bg-white p-4 text-sm leading-7 text-navy-800">
                <MuralFormattedText content={selectedPost.content} />
              </div>
              <div className="mt-5 grid gap-3 rounded-xl border border-border bg-slate-50 p-4 text-sm sm:grid-cols-2">
                <InfoLine label="Autor" value={`${selectedPost.authorName} • ${selectedPost.authorRole}`} />
                <InfoLine label="Publicado em" value={formatDateTimeShort(selectedPost.publishAt)} />
                <InfoLine label="Público-alvo" value={muralAudienceLabel(selectedPost.targetRoles)} />
                <InfoLine label="Expira em" value={selectedPost.expiresAt ? formatDateTimeShort(selectedPost.expiresAt) : "Sem expiração"} />
                {selectedPost.requiresAcknowledgement && selectedPost.acknowledgedByViewer ? <InfoLine label="Ciência" value={`Ciente em ${formatDateTimeShort(selectedPost.viewerAcknowledgedAt)}`} /> : null}
              </div>
              {selectedPost.requiresAcknowledgement && canManageMural ? (
                <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-black text-navy-950">Aderência de ciência</h3>
                      <p className="text-sm font-semibold text-muted">Acompanha apenas usuários elegíveis pelo público-alvo e pela LOB alvo do comunicado.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void exportMuralAcknowledgements(selectedPost.id).catch((error) => setMuralMessage(error.message))}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-extrabold text-white"
                    >
                      <Download className="h-4 w-4" /> Exportar XLSX
                    </button>
                  </div>
                  {acknowledgementPanel ? (
                    <>
                      <div className="mt-4 grid gap-3 sm:grid-cols-4">
                        <MuralAckMetric label="Elegíveis" value={acknowledgementPanel.summary.eligible} />
                        <MuralAckMetric label="Cientes" value={acknowledgementPanel.summary.acknowledged} tone="green" />
                        <MuralAckMetric label="Pendentes" value={acknowledgementPanel.summary.pending} tone={acknowledgementPanel.summary.pending ? "red" : "green"} />
                        <MuralAckMetric label="Aderência" value={`${acknowledgementPanel.summary.adherence ?? 0}%`} tone="blue" />
                      </div>
                      <div className="mt-4">
                        <ProgressLine label="Aderência total" value={acknowledgementPanel.summary.adherence ?? 0} tone="blue" />
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-[minmax(160px,1fr)_130px_140px_140px_auto]">
                        <input
                          value={acknowledgementFilters.q}
                          onChange={(event) => setAcknowledgementFilters({ ...acknowledgementFilters, q: event.target.value })}
                          className="h-9 rounded-lg border border-border px-3 text-sm outline-none"
                          placeholder="Buscar nome, WB ou e-mail"
                        />
                        <select
                          value={acknowledgementFilters.status}
                          onChange={(event) => setAcknowledgementFilters({ ...acknowledgementFilters, status: event.target.value })}
                          className="h-9 rounded-lg border border-border px-3 text-xs font-bold"
                        >
                          {["Todos", "Ciente", "Pendente"].map((item) => <option key={item}>{item}</option>)}
                        </select>
                        <select
                          value={acknowledgementFilters.role}
                          onChange={(event) => setAcknowledgementFilters({ ...acknowledgementFilters, role: event.target.value })}
                          className="h-9 rounded-lg border border-border px-3 text-xs font-bold"
                        >
                          <option value="Todos">Todos os públicos</option>
                          {muralTargetRoles.filter((role) => role.value !== "TODOS").map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                        </select>
                        <select
                          value={acknowledgementFilters.lobId}
                          onChange={(event) => setAcknowledgementFilters({ ...acknowledgementFilters, lobId: event.target.value })}
                          className="h-9 rounded-lg border border-border px-3 text-xs font-bold"
                        >
                          <option value="Todos">Todas as LOBs</option>
                          {muralLobs.map((lob) => <option key={lob.id} value={lob.id}>{lob.name}</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => void loadMuralAcknowledgements(selectedPost.id)}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-xs font-extrabold text-blue-700"
                        >
                          <RefreshCw className={cn("h-4 w-4", acknowledgementLoading && "animate-spin")} /> Filtrar
                        </button>
                      </div>
                      <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-border bg-white">
                        <table className="min-w-full text-left text-xs">
                          <thead className="sticky top-0 bg-slate-50 text-muted">
                            <tr>
                              {["Nome", "WB/Login", "Role", "LOB", "Supervisor", "Status", "Ciente em"].map((header) => (
                                <th key={header} className="px-3 py-2 font-black uppercase tracking-wide">{header}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {acknowledgementPanel.data.length ? acknowledgementPanel.data.map((row) => (
                              <tr key={row.userId} className="border-t border-border">
                                <td className="px-3 py-2 font-extrabold text-navy-950">{row.name}</td>
                                <td className="px-3 py-2 font-semibold text-muted">{row.wbLogin || "-"}</td>
                                <td className="px-3 py-2 font-semibold text-muted">{row.role}</td>
                                <td className="px-3 py-2 font-semibold text-muted">{row.lob}</td>
                                <td className="px-3 py-2 font-semibold text-muted">{row.supervisor || "-"}</td>
                                <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                                <td className="px-3 py-2 font-semibold text-muted">{row.acknowledgedAt ? formatDateTimeShort(row.acknowledgedAt) : "-"}</td>
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={7} className="px-3 py-6 text-center font-bold text-muted">Nenhum usuário encontrado nos filtros.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="mt-4 rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm font-bold text-blue-700">
                      {acknowledgementLoading ? "Carregando aderência..." : "Aderência ainda não carregada."}
                    </p>
                  )}
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {selectedPost.externalUrl ? <a href={selectedPost.externalUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Abrir link</a> : null}
                {selectedPost.mediaUrl ? <a href={selectedPost.mediaUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700">Abrir mídia</a> : null}
                {selectedPost.attachmentUrl ? <a href={selectedPost.attachmentUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-navy-950">Abrir anexo</a> : null}
                {selectedPost.requiresAcknowledgement && !selectedPost.acknowledgedByViewer && !canManageMural ? (
                  <button onClick={() => setAcknowledgePost(selectedPost)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Estou ciente</button>
                ) : null}
                {canManageMural ? (
                  <button
                    type="button"
                    disabled={deletingMuralPostId === selectedPost.id}
                    onClick={() => void deleteMuralPostClient(selectedPost)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    {deletingMuralPostId === selectedPost.id ? "Excluindo..." : "Excluir aviso"}
                  </button>
                ) : null}
                <button onClick={() => setSelectedPost(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-navy-950">Fechar</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {acknowledgePost ? (
        <div className="fixed inset-0 z-[55] grid place-items-center overflow-y-auto bg-navy-950/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-xl font-black text-navy-950">Confirmar ciência</h2>
              <p className="mt-1 text-sm font-semibold text-muted">Confirme que você leu e está ciente deste comunicado.</p>
            </div>
            <div className="space-y-3 p-5">
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-blue-700">Comunicado</p>
                <p className="mt-1 line-clamp-2 text-base font-extrabold text-navy-950">{acknowledgePost.title}</p>
              </div>
              <p className="text-sm leading-6 text-muted">
                Sua confirmação ficará registrada com data e hora para acompanhamento de aderência do Mural.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-slate-50 px-5 py-4">
              <button
                type="button"
                onClick={() => setAcknowledgePost(null)}
                disabled={acknowledgingPost}
                className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-bold text-navy-950 disabled:opacity-60"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => void confirmMuralAcknowledgement()}
                disabled={acknowledgingPost}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {acknowledgingPost ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {acknowledgingPost ? "Registrando..." : "Confirmar ciência"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {muralFormOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-navy-950/45 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-xl font-black text-navy-950">{editingPost ? "Editar aviso" : "Novo aviso"}</h2>
                <p className="text-sm text-muted">Envie uma capa recortada pelo sistema ou use uma URL pública de mídia/anexo.</p>
              </div>
              <button onClick={() => { clearMuralCoverDraft(); setMuralFormOpen(false); }} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid max-h-[75vh] gap-4 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-3">
                <FormInput label="Título" value={muralForm.title} onChange={(value) => setMuralForm({ ...muralForm, title: value })} />
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-muted">Conteúdo</span>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50/45 px-3 py-2">
                    <p className="text-xs font-semibold text-blue-800">Você pode usar **negrito** e *itálico* no texto.</p>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => formatMuralContent("**")} className="grid h-8 w-8 place-items-center rounded-md border border-blue-200 bg-white text-blue-700 hover:bg-blue-50" title="Negrito">
                        <Bold className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => formatMuralContent("*")} className="grid h-8 w-8 place-items-center rounded-md border border-blue-200 bg-white text-blue-700 hover:bg-blue-50" title="Itálico">
                        <Italic className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <textarea ref={muralContentInputRef} value={muralForm.content} onChange={(event) => setMuralForm({ ...muralForm, content: event.target.value })} className="min-h-36 w-full rounded-lg border border-border p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <FormSelect label="Tipo" value={muralForm.contentType} options={muralContentTypes} onChange={(value) => setMuralForm({ ...muralForm, contentType: value })} />
                  <FormSelect label="Prioridade" value={muralForm.priority} options={["BAIXA", "MEDIA", "ALTA", "CRITICA"]} onChange={(value) => setMuralForm({ ...muralForm, priority: value })} />
                  <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3 md:col-span-2">
                    <input
                      ref={muralCoverInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        handleMuralCoverFile(event.currentTarget.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-extrabold text-navy-950">Imagem/capa do aviso</p>
                        <p className="text-xs font-semibold text-muted">Envie PNG, JPG ou WEBP até 5 MB. O recorte final fica em 16:9.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => muralCoverInputRef.current?.click()} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-extrabold text-white">
                          <Upload className="h-4 w-4" /> Enviar imagem
                        </button>
                        {muralForm.imageUrl ? (
                          <button type="button" onClick={() => setMuralForm({ ...muralForm, imageUrl: "" })} className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-white px-3 text-xs font-extrabold text-navy-950">
                            Remover capa
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {muralCoverError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{muralCoverError}</p> : null}
                    <FormInput label="Ou cole uma URL pública da imagem" value={muralForm.imageUrl} onChange={(value) => setMuralForm({ ...muralForm, imageUrl: value })} />
                  </div>
                  <FormInput label="URL de mídia" value={muralForm.mediaUrl} onChange={(value) => setMuralForm({ ...muralForm, mediaUrl: value })} />
                  <FormInput label="Link externo" value={muralForm.externalUrl} onChange={(value) => setMuralForm({ ...muralForm, externalUrl: value })} />
                  <FormInput label="URL de anexo" value={muralForm.attachmentUrl} onChange={(value) => setMuralForm({ ...muralForm, attachmentUrl: value })} />
                  <FormInput label="Expira em" type="date" value={muralForm.expiresAt} onChange={(value) => setMuralForm({ ...muralForm, expiresAt: value })} />
                  <FormSelect label="Status" value={muralForm.status} options={["RASCUNHO", "PUBLICADO", "INATIVO", "ARQUIVADO"]} onChange={(value) => setMuralForm({ ...muralForm, status: value })} />
                </div>
                <label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm font-bold">
                  <input type="checkbox" checked={muralForm.isPinned} onChange={(event) => setMuralForm({ ...muralForm, isPinned: event.target.checked })} />
                  Fixar aviso no topo
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm">
                  <input className="mt-1" type="checkbox" checked={muralForm.requiresAcknowledgement} onChange={(event) => setMuralForm({ ...muralForm, requiresAcknowledgement: event.target.checked })} />
                  <span>
                    <span className="block font-extrabold text-navy-950">Exigir ciência dos leitores</span>
                    <span className="mt-1 block text-xs font-semibold text-muted">Quando ativado, os usuários do público-alvo deverão confirmar que leram este comunicado.</span>
                  </span>
                </label>
                <div>
                  <p className="mb-2 text-sm font-bold text-muted">Público-alvo</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {muralTargetRoles.map((role) => (
                      <label key={role.value} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-bold">
                        <input type="checkbox" checked={muralForm.targetRoles.includes(role.value)} onChange={(event) => updateMuralTargetRole(role.value, event.target.checked)} />
                        {role.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-bold text-muted">LOB alvo</p>
                  <div className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">
                    {muralLobs.map((lob) => (
                      <label key={lob.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-bold">
                        <input type="checkbox" checked={muralForm.targetLobIds.includes(lob.id)} onChange={(event) => updateMuralTargetLob(lob.id, event.target.checked)} />
                        {lob.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-bold text-muted">Preview</p>
                <article className="card overflow-hidden p-0">
                  <MuralPostVisual post={muralFormToPreview(muralForm)} />
                  <div className="p-4">
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={muralPriorityLabel(muralForm.priority)} />
                      {muralForm.requiresAcknowledgement ? <StatusBadge status="Exige ciência" /> : null}
                    </div>
                    <h3 className="mt-3 font-black text-navy-950">{muralForm.title || "Título do aviso"}</h3>
                    <div className="mt-2 line-clamp-3 text-sm leading-6 text-muted">
                      <MuralFormattedText content={muralForm.content || "Resumo do comunicado aparecerá aqui."} />
                    </div>
                  </div>
                </article>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-slate-50 px-5 py-4">
              <button onClick={() => { clearMuralCoverDraft(); setMuralFormOpen(false); }} className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-bold text-navy-950">Cancelar</button>
              <button disabled={savingMuralPost} onClick={() => void saveMuralPost()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{savingMuralPost ? "Salvando..." : "Salvar aviso"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {muralCoverDraft ? (
        <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-navy-950/55 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-xl font-black text-navy-950">Ajustar recorte da capa</h2>
                <p className="text-sm text-muted">Centralize o assunto principal. A imagem será salva em 1200x675.</p>
              </div>
              <button onClick={clearMuralCoverDraft} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="space-y-4 p-5">
              <div className="overflow-hidden rounded-xl border border-border bg-slate-100">
                <div className="relative aspect-video overflow-hidden">
                  {/* Native image dimensions are required by the client-side crop canvas. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={muralCoverImageRef}
                    src={muralCoverDraft.sourceUrl}
                    alt="Prévia da capa"
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{
                      objectPosition: `${muralCoverCrop.x}% ${muralCoverCrop.y}%`,
                      width: `${muralCoverCrop.zoom * 100}%`,
                      height: `${muralCoverCrop.zoom * 100}%`,
                      left: `${(1 - muralCoverCrop.zoom) * 50}%`,
                      top: `${(1 - muralCoverCrop.zoom) * 50}%`
                    }}
                  />
                  <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/70" />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="rounded-lg border border-border bg-white p-3">
                  <span className="text-xs font-extrabold uppercase text-muted">Horizontal</span>
                  <input type="range" min="0" max="100" value={muralCoverCrop.x} onChange={(event) => setMuralCoverCrop({ ...muralCoverCrop, x: Number(event.target.value) })} className="mt-2 w-full" />
                </label>
                <label className="rounded-lg border border-border bg-white p-3">
                  <span className="text-xs font-extrabold uppercase text-muted">Vertical</span>
                  <input type="range" min="0" max="100" value={muralCoverCrop.y} onChange={(event) => setMuralCoverCrop({ ...muralCoverCrop, y: Number(event.target.value) })} className="mt-2 w-full" />
                </label>
                <label className="rounded-lg border border-border bg-white p-3">
                  <span className="text-xs font-extrabold uppercase text-muted">Aproximação</span>
                  <input type="range" min="1" max="2.5" step="0.05" value={muralCoverCrop.zoom} onChange={(event) => setMuralCoverCrop({ ...muralCoverCrop, zoom: Number(event.target.value) })} className="mt-2 w-full" />
                </label>
              </div>
              {muralCoverError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{muralCoverError}</p> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-slate-50 px-5 py-4">
              <button type="button" onClick={clearMuralCoverDraft} className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-bold text-navy-950">Voltar</button>
              <button type="button" disabled={uploadingMuralCover} onClick={() => void uploadMuralCoverCrop()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                {uploadingMuralCover ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploadingMuralCover ? "Enviando..." : "Salvar capa"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
