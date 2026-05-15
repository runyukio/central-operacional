import type { Actor, InternalNotificationRecord } from "@/lib/mock-db";
import { listNotifications as listMockNotifications, markNotificationRead as markMockNotificationRead, recordErrorLog } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";

const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";

export async function listInternalNotifications(actor: Actor) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email } });
    if (!user) return allowDemoDataFallback ? listMockNotifications(actor) : [];

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 30
    });

    return notifications.map<InternalNotificationRecord>((notification) => ({
      id: notification.id,
      userEmail: actor.email,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      href: notification.href ?? undefined,
      isRead: notification.isRead,
      createdAt: formatDateTime(notification.createdAt),
      readAt: notification.readAt ? formatDateTime(notification.readAt) : undefined
    }));
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "NOTIFICATION_LIST_DB_FALLBACK",
      message: error instanceof Error ? error.message : "Falha ao listar notificações no banco",
      route: "/api/notifications",
      action: "NOTIFICATION_LIST",
      severity: "WARNING"
    });
    return allowDemoDataFallback ? listMockNotifications(actor) : [];
  }
}

export async function markInternalNotificationRead(actor: Actor, id: string) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email } });
    if (!user) return allowDemoDataFallback ? markMockNotificationRead(actor, id) : [];

    if (id === "ALL") {
      await prisma.notification.updateMany({
        where: { userId: user.id, isRead: false, deletedAt: null },
        data: { isRead: true, readAt: new Date() }
      });
    } else {
      await prisma.notification.updateMany({
        where: { id, userId: user.id },
        data: { isRead: true, readAt: new Date() }
      });
    }

    return listInternalNotifications(actor);
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "NOTIFICATION_READ_DB_FALLBACK",
      message: error instanceof Error ? error.message : "Falha ao marcar notificação como lida",
      route: "/api/notifications",
      action: "NOTIFICATION_READ",
      severity: "WARNING"
    });
    return allowDemoDataFallback ? markMockNotificationRead(actor, id) : [];
  }
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
