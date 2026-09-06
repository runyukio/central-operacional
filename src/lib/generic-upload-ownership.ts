/** Generic uploads cannot assert ownership or link themselves to another entity.
 * Entity-specific attachments must use that feature's authorized upload flow. */
export function genericUploadOwnershipError(
  owner: { email: string; employeeId?: string | null },
  claims: { ownerUserEmail?: string; employeeId?: string; entity?: string; entityId?: string }
) {
  if (claims.ownerUserEmail?.trim() && claims.ownerUserEmail.trim().toLowerCase() !== owner.email.toLowerCase()) {
    return "O proprietário do arquivo deve ser o usuário autenticado.";
  }
  if (claims.employeeId?.trim() && claims.employeeId.trim() !== owner.employeeId) {
    return "Este arquivo não pode ser associado a outro parceiro por este upload.";
  }
  if (claims.entity?.trim() || claims.entityId?.trim()) {
    return "Para vincular o arquivo, utilize o upload na tela da solicitação ou do documento correspondente.";
  }
  return null;
}
