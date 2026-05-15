import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const keepAdminEmail = process.env.INITIAL_ADMIN_EMAIL ?? "admin@central.com";

async function main() {
  await prisma.storedFile.deleteMany();
  await prisma.errorLog.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.chatParticipant.deleteMany();
  await prisma.chatRoom.deleteMany();
  await prisma.rewardRedemption.deleteMany();
  await prisma.reward.deleteMany();
  await prisma.tokenTransaction.deleteMany();
  await prisma.tokenBalance.deleteMany();
  await prisma.staffCoverage.deleteMany();
  await prisma.equipmentTicket.deleteMany();
  await prisma.equipmentHistory.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.actionPlan.deleteMany();
  await prisma.anonymousFeedback.deleteMany();
  await prisma.climateAnswer.deleteMany();
  await prisma.climateQuestion.deleteMany();
  await prisma.climateSurvey.deleteMany();
  await prisma.qualityMaterial.deleteMany();
  await prisma.qualityFeedback.deleteMany();
  await prisma.performanceMetric.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.announcementRead.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.approvalStep.deleteMany();
  await prisma.approvalFlow.deleteMany();
  await prisma.requestHistory.deleteMany();
  await prisma.requestComment.deleteMany();
  await prisma.request.deleteMany();
  await prisma.scheduleChangeHistory.deleteMany();
  await prisma.attendanceHistory.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.scheduleImportRow.deleteMany();
  await prisma.scheduleImport.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.employeeSensitiveData.deleteMany();
  await prisma.birthdayNotification.deleteMany();
  await prisma.employeeCampaignSegment.deleteMany();
  await prisma.employeeRegistrationRequest.deleteMany();
  await prisma.team.updateMany({ data: { supervisorId: null } });
  await prisma.employeeProfile.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.user.deleteMany({ where: { email: { not: keepAdminEmail } } });
  await prisma.team.deleteMany();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
