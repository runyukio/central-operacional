import { EmployeeProfilePage } from "@/components/employee-profile-page";

export default async function PerfilColaboradorRoute({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  return <EmployeeProfilePage employeeId={employeeId} />;
}
