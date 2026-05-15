import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export type ApiErrorType =
  | "VALIDATION_ERROR"
  | "DUPLICATE_ERROR"
  | "PERMISSION_ERROR"
  | "RELATION_ERROR"
  | "NOT_FOUND_ERROR"
  | "SERVER_ERROR";

export type ApiErrorPayload = {
  success: false;
  type: ApiErrorType;
  message: string;
  error: string;
  fieldErrors?: Record<string, string>;
  fields?: Record<string, string>;
};

export function createValidationError(fieldErrors: Record<string, string>, message = "Existem campos inválidos. Revise os campos destacados."): ApiErrorPayload {
  return buildError("VALIDATION_ERROR", message, fieldErrors);
}

export function createDuplicateError(message: string, fieldErrors?: Record<string, string>): ApiErrorPayload {
  return buildError("DUPLICATE_ERROR", message, fieldErrors);
}

export function createPermissionError(message = "Você não tem permissão para executar esta ação."): ApiErrorPayload {
  return buildError("PERMISSION_ERROR", message);
}

export function createRelationError(message: string, fieldErrors?: Record<string, string>): ApiErrorPayload {
  return buildError("RELATION_ERROR", message, fieldErrors);
}

export function createNotFoundError(message = "Registro não encontrado ou já removido."): ApiErrorPayload {
  return buildError("NOT_FOUND_ERROR", message);
}

export function createServerError(error: unknown, message = "Erro inesperado ao salvar. Tente novamente ou contate o administrador."): ApiErrorPayload {
  console.error("[api] erro inesperado", error);
  return buildError("SERVER_ERROR", message);
}

export function mapZodError(error: ZodError): ApiErrorPayload {
  const flattened = error.flatten().fieldErrors;
  const fieldErrors = Object.fromEntries(
    Object.entries(flattened).map(([field, messages]) => [field, messages?.[0] ?? "Campo inválido."])
  );
  return createValidationError(fieldErrors);
}

export function mapPrismaError(error: unknown): ApiErrorPayload | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const fields = targetFields(error.meta?.target);
  if (error.code === "P2002") {
    const fieldErrors = Object.fromEntries(fields.map((field) => [field, duplicateMessage(field)]));
    return createDuplicateError(Object.values(fieldErrors)[0] ?? "Já existe um registro com estes dados.", fieldErrors);
  }
  if (error.code === "P2003") {
    const field = fields[0] ?? String(error.meta?.field_name ?? "relacionamento");
    return createRelationError(relationMessage(field), { [normalizeFieldName(field)]: relationMessage(field) });
  }
  if (error.code === "P2025") return createNotFoundError();
  if (error.code === "P2000") return createValidationError({ value: "Valor muito longo para o campo." });
  if (error.code === "P2006") return createValidationError({ value: "Valor inválido para o campo." });
  if (error.code === "P2011") return createValidationError({ value: "Campo obrigatório nulo." });
  if (error.code === "P2012") return createValidationError({ value: "Campo obrigatório ausente." });
  if (error.code === "P2014") return createRelationError("Relação obrigatória violada.");
  return null;
}

export function errorStatus(payload: ApiErrorPayload) {
  if (payload.type === "PERMISSION_ERROR") return 403;
  if (payload.type === "NOT_FOUND_ERROR") return 404;
  if (payload.type === "DUPLICATE_ERROR") return 409;
  if (payload.type === "SERVER_ERROR") return 500;
  return 400;
}

export function errorResponse(payload: ApiErrorPayload, status = errorStatus(payload)) {
  return NextResponse.json(payload, { status });
}

function buildError(type: ApiErrorType, message: string, fieldErrors?: Record<string, string>): ApiErrorPayload {
  return {
    success: false,
    type,
    message,
    error: message,
    ...(fieldErrors ? { fieldErrors, fields: fieldErrors } : {})
  };
}

function targetFields(target: unknown) {
  if (Array.isArray(target)) return target.map((field) => normalizeFieldName(String(field)));
  if (typeof target === "string") return [normalizeFieldName(target)];
  return [];
}

function normalizeFieldName(field: string) {
  const map: Record<string, string> = {
    email: "email",
    cpf: "cpf",
    wbLogin: "wbLogin",
    wb_login: "wbLogin",
    lobId: "lobId",
    supervisorId: "supervisorId",
    teamId: "teamId",
    shiftId: "shiftId",
    roleId: "roleName",
    userId: "userId"
  };
  return map[field] ?? field;
}

function duplicateMessage(field: string) {
  if (field === "email") return "Este e-mail já está em uso.";
  if (field === "cpf") return "Este CPF já está cadastrado.";
  if (field === "wbLogin") return "Este WB/Login já está em uso.";
  return "Já existe um registro com este valor.";
}

function relationMessage(field: string) {
  if (field === "lobId") return "LOB selecionada não existe.";
  if (field === "supervisorId") return "Supervisor selecionado não existe.";
  if (field === "teamId") return "Time selecionado não existe.";
  if (field === "shiftId") return "Turno selecionado não existe.";
  if (field === "roleName" || field === "roleId") return "Role/Permissão selecionada não existe.";
  return "Relacionamento selecionado não existe.";
}
