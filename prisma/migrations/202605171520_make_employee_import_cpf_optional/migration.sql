-- Permite importar colaboradores sem CPF na base inicial.
-- WB/Login continua sendo a chave operacional obrigatoria.
ALTER TABLE "EmployeeRegistrationRequest" ALTER COLUMN "cpf" DROP NOT NULL;
ALTER TABLE "EmployeeSensitiveData" ALTER COLUMN "cpf" DROP NOT NULL;
