import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const demoPassword = "Central@123";
const isProduction = process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";
const allowDemoSeed = process.env.ALLOW_DEMO_SEED === "true";

function date(day: number, hour = 9, minute = 0) {
  return new Date(Date.UTC(2026, 4, day, hour, minute, 0));
}

function pct(seed: number, min: number, max: number) {
  return Number((min + (seed % 13) * ((max - min) / 12)).toFixed(1));
}

async function cleanDatabase() {
  await prisma.storedFile.deleteMany();
  await prisma.errorLog.deleteMany();
  await prisma.auditLog.deleteMany();
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
  await prisma.requestType.deleteMany();
  await prisma.scheduleChangeHistory.deleteMany();
  await prisma.scheduleImportRow.deleteMany();
  await prisma.scheduleImport.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.employeeProfile.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.user.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.team.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.lob.deleteMany();
  await prisma.role.deleteMany();
  await prisma.systemConfig.deleteMany();
}

async function main() {
  if (isProduction && !allowDemoSeed) {
    throw new Error("Seed demo bloqueado em produção. Defina ALLOW_DEMO_SEED=true apenas em ambiente controlado.");
  }

  await cleanDatabase();

  const passwordHash = await bcrypt.hash(demoPassword, 10);

  const roles = Object.fromEntries(
    await Promise.all(
      [
        ["ADMIN", "Administrador"],
        ["GESTOR", "Gestão"],
        ["SUPERVISOR", "Supervisor"],
        ["COLABORADOR", "Colaborador"],
        ["WFM", "WFM / Planejamento"],
        ["QUALIDADE", "Qualidade"],
        ["RH", "Recursos Humanos"],
        ["TI", "Logística / TI"]
      ].map(([name, label]) =>
        prisma.role.create({
          data: {
            name,
            label,
            description: `Perfil ${label} da Central Operacional`
          }
        })
      )
    ).then((items) => items.map((role) => [role.name, role]))
  );

  await prisma.permission.createMany({
    data: [
      "dashboard:view",
      "schedules:import",
      "requests:approve",
      "announcements:create",
      "quality:create",
      "equipment:manage",
      "audit:view",
      "settings:manage"
    ].map((key) => ({
      key,
      label: key.replace(":", " / ")
    }))
  });

  const lobNames = ["CEC", "TNS", "ADS"];
  const lobs = Object.fromEntries(
    await Promise.all(
      lobNames.map((name) =>
        prisma.lob.create({
          data: {
            name,
            description: `Operação ${name}`
          }
        })
      )
    ).then((items) => items.map((lob) => [lob.name, lob]))
  );

  const shifts = Object.fromEntries(
    await Promise.all(
      [
        ["Manhã", "06:00", "14:00", "#10B981"],
        ["Tarde", "14:00", "22:00", "#2563EB"],
        ["Noite", "22:00", "06:00", "#7C3AED"],
        ["Backoffice", "08:00", "16:00", "#F59E0B"]
      ].map(([name, startsAt, endsAt, color]) =>
        prisma.shift.create({
          data: { name, startsAt, endsAt, color }
        })
      )
    ).then((items) => items.map((shift) => [shift.name, shift]))
  );

  const teams = Object.fromEntries(
    await Promise.all(
      [
        ["Equipe Alfa", "CEC"],
        ["Equipe Bravo", "CEC"],
        ["Equipe Charlie", "TNS"],
        ["Equipe Delta", "ADS"],
        ["Equipe Echo", "ADS"]
      ].map(([name, lob]) =>
        prisma.team.create({
          data: {
            name,
            lobId: lobs[lob].id
          }
        })
      )
    ).then((items) => items.map((team) => [team.name, team]))
  );

  const demoUsers = [
    ["admin@central.com", "Admin Central", "ADMIN"],
    ["gestor@central.com", "Marina Gestão", "GESTOR"],
    ["supervisor@central.com", "Carla Supervisora", "SUPERVISOR"],
    ["supervisor2@central.com", "Rafael Supervisor", "SUPERVISOR"],
    ["colaborador@central.com", "João Silva", "COLABORADOR"],
    ["wfm@central.com", "WFM Operações", "WFM"],
    ["qualidade@central.com", "Ana Qualidade", "QUALIDADE"],
    ["rh@central.com", "Beatriz RH", "RH"],
    ["ti@central.com", "Thiago TI", "TI"]
  ] as const;

  const users = Object.fromEntries(
    await Promise.all(
      demoUsers.map(([email, name, role]) =>
        prisma.user.create({
          data: {
            email,
            name,
            passwordHash,
            roleId: roles[role].id,
            avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`
          }
        })
      )
    ).then((items) => items.map((user) => [user.email, user]))
  );

  const supervisorA = await prisma.employeeProfile.create({
    data: {
      userId: users["supervisor@central.com"].id,
      wbLogin: "WB0901",
      fullName: "Carla Supervisora",
      roleTitle: "Supervisora de Atendimento",
      admissionDate: date(1),
      scheduleType: "5x2",
      lobId: lobs.CEC.id,
      teamId: teams["Equipe Alfa"].id,
      shiftId: shifts["Manhã"].id
    }
  });

  const supervisorB = await prisma.employeeProfile.create({
    data: {
      userId: users["supervisor2@central.com"].id,
      wbLogin: "WB0902",
      fullName: "Rafael Supervisor",
      roleTitle: "Supervisor de Operações",
      admissionDate: date(2),
      scheduleType: "5x2",
      lobId: lobs.TNS.id,
      teamId: teams["Equipe Charlie"].id,
      shiftId: shifts["Tarde"].id
    }
  });

  await prisma.team.update({
    where: { id: teams["Equipe Alfa"].id },
    data: { supervisorId: supervisorA.id }
  });
  await prisma.team.update({
    where: { id: teams["Equipe Charlie"].id },
    data: { supervisorId: supervisorB.id }
  });

  const firstEmployee = await prisma.employeeProfile.create({
    data: {
      userId: users["colaborador@central.com"].id,
      wbLogin: "WB1001",
      fullName: "João Silva",
      roleTitle: "Atendente",
      admissionDate: date(3),
      scheduleType: "6x1",
      operationalStatus: "Online",
      lobId: lobs.CEC.id,
      teamId: teams["Equipe Alfa"].id,
      supervisorId: supervisorA.id,
      shiftId: shifts["Manhã"].id
    }
  });

  const names = [
    "Ana Carolina",
    "Bruno Ribeiro",
    "Camila Lima",
    "Diego Fernandes",
    "Eduardo Gomes",
    "Fernanda Souza",
    "Gabriel Rocha",
    "Hugo Tavares",
    "Isabela Nunes",
    "Juliana Santos",
    "Larissa Souza",
    "Marcos Costa",
    "Nathalia Alves",
    "Otavio Martins",
    "Paula Ribeiro",
    "Rafael Lima",
    "Sofia Mendes",
    "Thiago Ferreira",
    "Vanessa Carvalho",
    "Yasmin Duarte",
    "Amanda Martins",
    "Carlos Bessa",
    "Carla Mendes",
    "Diego Ribeiro",
    "Juliana Costa",
    "Lucas Andrade",
    "Mateus Martins",
    "Patricia Moraes",
    "Renato Melo",
    "Sandra Lopes",
    "Vitor Hugo",
    "Bianca Prado",
    "Felipe Torres",
    "Helena Castro",
    "Igor Almeida",
    "Leticia Barros",
    "Mariana Pinto",
    "Nelson Freitas",
    "Priscila Gomes",
    "Roberto Reis"
  ];

  const generatedEmployees = await Promise.all(
    names.map(async (name, index) => {
      const user = await prisma.user.create({
        data: {
          email: `colaborador${index + 2}@central.com`,
          name,
          passwordHash,
          roleId: roles.COLABORADOR.id,
          avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`
        }
      });
      const teamList = Object.values(teams);
      const team = teamList[index % teamList.length];
      const lob = Object.values(lobs).find((item) => item.id === team.lobId)!;
      const shift = Object.values(shifts)[index % Object.values(shifts).length];
      return prisma.employeeProfile.create({
        data: {
          userId: user.id,
          wbLogin: `WB${String(1002 + index).padStart(4, "0")}`,
          fullName: name,
          roleTitle: index % 5 === 0 ? "Analista" : index % 4 === 0 ? "Técnico" : "Atendente",
          admissionDate: date((index % 24) + 1),
          scheduleType: index % 6 === 0 ? "5x2" : "6x1",
          operationalStatus: index % 9 === 0 ? "Offline" : index % 7 === 0 ? "Em Atendimento" : "Online",
          lobId: lob.id,
          teamId: team.id,
          supervisorId: index % 2 === 0 ? supervisorA.id : supervisorB.id,
          shiftId: shift.id
        }
      });
    })
  );

  const employees = [firstEmployee, supervisorA, supervisorB, ...generatedEmployees];
  const workingShifts = Object.values(shifts);

  for (const [employeeIndex, employee] of employees.entries()) {
    for (let day = 1; day <= 31; day += 1) {
      const weekday = new Date(Date.UTC(2026, 4, day)).getUTCDay();
      const isWeekendOff = employee.scheduleType === "5x2" && (weekday === 0 || weekday === 6);
      const sixByOneOff = employee.scheduleType === "6x1" && (day + employeeIndex) % 7 === 0;
      const shift = workingShifts[(employeeIndex + day) % workingShifts.length];
      await prisma.schedule.create({
        data: {
          employeeId: employee.id,
          shiftId: isWeekendOff || sixByOneOff ? null : shift.id,
          date: date(day, 0, 0),
          startsAt: isWeekendOff || sixByOneOff ? null : shift.startsAt,
          endsAt: isWeekendOff || sixByOneOff ? null : shift.endsAt,
          status: day === 15 && employeeIndex % 11 === 0 ? "TREINAMENTO" : isWeekendOff || sixByOneOff ? "FOLGA" : "ESCALADO",
          observation: day === 15 && employeeIndex % 11 === 0 ? "Treinamento obrigatório" : null
        }
      });
    }
  }

  const requestTypes = Object.fromEntries(
    await Promise.all(
      [
        ["Troca de Folga", "WFM"],
        ["Venda de Folga", "WFM"],
        ["Solicitação de Dia de Folga", "WFM"],
        ["Ajuste de escala", "WFM"],
        ["Correção de escala", "WFM"],
        ["Solicitação de equipamento", "TI"],
        ["Problema com notebook/computador", "TI"],
        ["Solicitação de acesso", "TI"],
        ["Solicitação para qualidade", "Qualidade"],
        ["Solicitação para RH", "RH"],
        ["Solicitação para operação", "Operações"],
        ["Ajuste de ponto/presença", "Operações"],
        ["Alteração cadastral", "RH"],
        ["Feedback anônimo", "RH"],
        ["Pesquisa de clima", "RH"],
        ["Suporte geral", "Operações"]
      ].map(([name, area], index) =>
        prisma.requestType.create({
          data: {
            name,
            area,
            slaHours: index % 3 === 0 ? 12 : 24,
            requiresApproval: !["Suporte geral", "Solicitação de acesso"].includes(name)
          }
        })
      )
    ).then((items) => items.map((type) => [type.name, type]))
  );

  const statuses = ["ABERTO", "EM_ANALISE", "AGUARDANDO_APROVACAO", "APROVADO", "RECUSADO", "AJUSTE_SOLICITADO", "CONCLUIDO"] as const;
  for (let index = 0; index < 24; index += 1) {
    const type = Object.values(requestTypes)[index % Object.values(requestTypes).length];
    const employee = employees[index % employees.length];
    const request = await prisma.request.create({
      data: {
        code: `REQ-${String(1024 + index).padStart(4, "0")}`,
        title: type.name,
        description: `Solicitação de ${type.name.toLowerCase()} para demonstração operacional.`,
        requesterId: employee.userId ?? users["colaborador@central.com"].id,
        employeeId: employee.id,
        typeId: type.id,
        assigneeId: index % 3 === 0 ? users["wfm@central.com"].id : null,
        assignedArea: type.area,
        priority: index % 5 === 0 ? "ALTA" : index % 4 === 0 ? "BAIXA" : "MEDIA",
        status: statuses[index % statuses.length],
        payload:
          type.name === "Troca de Folga"
            ? { internalType: "DAY_OFF_SWAP", dayOffKind: "DAY_OFF_SWAP", currentDayOffDate: "2026-05-18", desiredDayOffDate: "2026-05-23", justification: "Reorganização pessoal", scheduleApplicationStatus: "PENDING" }
            : type.name === "Venda de Folga"
              ? { internalType: "DAY_OFF_SELL", dayOffKind: "DAY_OFF_SELL", dayOffToSellDate: "2026-05-18", availabilityShift: "Manhã", justification: "Disponibilidade para reforço operacional", scheduleApplicationStatus: "PENDING" }
              : type.name === "Solicitação de Dia de Folga"
                ? { internalType: "DAY_OFF_REQUEST", dayOffKind: "DAY_OFF_REQUEST", desiredDayOffRequestDate: "2026-05-23", dayOffReason: "Pessoal", urgency: "Média", justification: "Compromisso externo", scheduleApplicationStatus: "PENDING" }
            : { origem: "seed" }
      }
    });
    await prisma.requestHistory.create({
      data: {
        requestId: request.id,
        actorId: users["supervisor@central.com"].id,
        action: "Seed",
        to: request.status,
        reason: "Seed de demonstração"
      }
    });
    if (index % 2 === 0) {
      await prisma.requestComment.create({
        data: {
          requestId: request.id,
          authorId: users["supervisor@central.com"].id,
          message: "Solicitação recebida e em acompanhamento."
        }
      });
    }
  }

  const announcements = await Promise.all(
    [
      ["Atualização no Plano de Saúde", "Novas condições e coberturas a partir de junho.", "Administrativo", true, true],
      ["Manutenção Programada", "Sistemas indisponíveis no dia 26/05 das 00h às 04h.", "TI e Sistemas", true, true],
      ["Resultados do 1º Trimestre", "Confira os destaques e conquistas do período.", "Financeiro", false, false],
      ["Treinamento de Segurança", "Participe até 30/05.", "Recursos Humanos", true, true],
      ["Pesquisa de Clima", "Sua opinião é muito importante para melhorarmos a operação.", "Recursos Humanos", false, false]
    ].map(([title, content, category, isPinned, requiresRead]) =>
      prisma.announcement.create({
        data: {
          title: String(title),
          content: String(content),
          category: String(category),
          targetAudience: "Todos",
          authorId: users["admin@central.com"].id,
          isPinned: Boolean(isPinned),
          requiresRead: Boolean(requiresRead),
          publishAt: date(23, 9, 15)
        }
      })
    )
  );

  for (const user of Object.values(users)) {
    await prisma.notification.createMany({
      data: announcements.slice(0, 3).map((announcement, index) => ({
        userId: user.id,
        title: announcement.title,
        body: announcement.content,
        category: announcement.category,
        href: "/mural",
        isRead: index === 2
      }))
    });
  }

  for (const [index, employee] of employees.entries()) {
    await prisma.performanceMetric.create({
      data: {
        employeeId: employee.id,
        period: date(1, 0, 0),
        productivity: pct(index, 82, 132),
        quality: pct(index + 3, 70, 99),
        presence: pct(index + 5, 82, 100),
        adherence: pct(index + 7, 78, 98),
        tokensEarned: 20 + (index % 8) * 5
      }
    });
    await prisma.tokenBalance.create({
      data: {
        employeeId: employee.id,
        balance: 120 + (index % 9) * 35
      }
    });
    await prisma.tokenTransaction.create({
      data: {
        employeeId: employee.id,
        type: "GANHO",
        amount: 40,
        reason: "Qualidade acima da meta",
        campaign: "Reconhecimento Maio"
      }
    });
  }

  for (const [index, employee] of employees.slice(0, 14).entries()) {
    await prisma.qualityFeedback.create({
      data: {
        employeeId: employee.id,
        authorId: users["qualidade@central.com"].id,
        type: index % 4 === 0 ? "Orientação individual" : "Pílula de feedback",
        theme: ["Clareza na comunicação", "Empatia demonstrada", "Informação incompleta", "Atitude exemplar"][index % 4],
        message: index % 4 === 2 ? "Faltou detalhar o prazo de retorno ao cliente." : "Boa prática registrada no atendimento.",
        classification: index % 4 === 2 ? "ATENCAO" : "POSITIVO",
        readAt: index % 3 === 0 ? null : date(23, 11, index)
      }
    });
  }

  await prisma.qualityMaterial.createMany({
    data: [
      ["Guia de Boas Práticas", "Dicas e padrões de atendimento", "/qualidade"],
      ["Comunicação Empática", "Técnicas para ouvir e responder melhor", "/qualidade"],
      ["Tratamento de Objeções", "Como lidar com as principais objeções", "/qualidade"],
      ["Política de Qualidade", "Diretrizes e critérios de avaliação", "/qualidade"]
    ].map(([title, description, url]) => ({
      title,
      description,
      url,
      category: "Atendimento",
      authorId: users["qualidade@central.com"].id
    }))
  });

  const equipmentTypes = ["Notebook Dell", "Headset", "Monitor", "Desktop", "Rádio Comunicador", "Impressora Térmica"];
  const equipments = await Promise.all(
    employees.slice(0, 30).map((employee, index) =>
      prisma.equipment.create({
        data: {
          code: `EQP-${String(index + 1).padStart(4, "0")}`,
          type: equipmentTypes[index % equipmentTypes.length],
          model: index % 2 === 0 ? "Corporativo A" : "Corporativo B",
          serial: `SN-${202605}${index}`,
          employeeId: employee.id,
          status: index % 10 === 0 ? "INOPERANTE" : index % 6 === 0 ? "EM_MANUTENCAO" : "FUNCIONANDO",
          deliveredAt: date(Math.max(1, 23 - (index % 10))),
          impact: index % 10 === 0 ? "ALTO" : index % 6 === 0 ? "MEDIO" : "BAIXO"
        }
      })
    )
  );

  for (const [index, equipment] of equipments.slice(0, 8).entries()) {
    await prisma.equipmentTicket.create({
      data: {
        code: `CHM-${1020 + index}`,
        equipmentId: equipment.id,
        employeeId: equipment.employeeId,
        openedById: users["ti@central.com"].id,
        title: index % 2 === 0 ? "Falha no equipamento" : "Manutenção preventiva",
        description: "Chamado técnico aberto para acompanhamento de SLA.",
        impact: index % 3 === 0 ? "ALTO" : index % 2 === 0 ? "MEDIO" : "BAIXO",
        status: index % 4 === 0 ? "EM_ATENDIMENTO" : "ABERTO",
        slaDueAt: date(24 + (index % 4), 18, 0)
      }
    });
  }

  for (let day = 20; day <= 26; day += 1) {
    for (const lob of Object.values(lobs)) {
      for (const shift of Object.values(shifts)) {
        const required = 28 + ((day + shift.name.length) % 8);
        const planned = required - ((day + shift.name.length + lob.name.length) % 6);
        const coverage = Number(((planned / required) * 100).toFixed(1));
        await prisma.staffCoverage.create({
          data: {
            date: date(day, 0, 0),
            lobId: lob.id,
            shiftId: shift.id,
            plannedStaff: planned,
            requiredStaff: required,
            coveragePercent: coverage,
            gap: planned - required,
            risk: coverage >= 95 ? "EXCELENTE" : coverage >= 90 ? "ADEQUADO" : coverage >= 85 ? "ATENCAO" : "CRITICO"
          }
        });
      }
    }
  }

  const survey = await prisma.climateSurvey.create({
    data: {
      title: "Pesquisa de Clima - Maio",
      description: "Diagnóstico mensal de satisfação e engajamento.",
      startsAt: date(1),
      endsAt: date(31)
    }
  });
  const climateQuestions = await Promise.all(
    [
      ["Como você avalia seu ambiente de trabalho?", "ESCALA_1_5"],
      ["Você recomendaria a Central como um bom lugar para trabalhar?", "SIM_NAO"],
      ["Qual tema merece mais atenção?", "MULTIPLA_ESCOLHA"],
      ["Deixe uma sugestão de melhoria", "TEXTO_LIVRE"]
    ].map(([text, type], index) =>
      prisma.climateQuestion.create({
        data: {
          surveyId: survey.id,
          text,
          type: type as never,
          options: type === "MULTIPLA_ESCOLHA" ? ["Ferramentas", "Liderança", "Processos", "Ambiente"] : undefined,
          order: index + 1
        }
      })
    )
  );
  for (const [index, employee] of employees.slice(0, 30).entries()) {
    await prisma.climateAnswer.create({
      data: {
        surveyId: survey.id,
        questionId: climateQuestions[0].id,
        respondentId: employee.userId,
        value: 3 + (index % 3)
      }
    });
  }

  await prisma.anonymousFeedback.createMany({
    data: [
      ["Ferramentas", "Oscilações frequentes em uma ferramenta impactam o atendimento.", "Ferramentas", "EM_ANALISE"],
      ["Liderança", "Sugestão para rituais mais objetivos de alinhamento.", "Liderança", "RECEBIDO"],
      ["Processos", "Fluxo de aprovação poderia ter etapas mais claras.", "Processos", "PLANO_DE_ACAO"]
    ].map(([category, message, theme, status]) => ({
      category,
      message,
      theme,
      status: status as never
    }))
  });

  const rewards = await Promise.all(
    [
      ["Vale-presente", "Crédito para compra em lojas parceiras", 250],
      ["Day off", "Folga bonificada mediante aprovação", 500],
      ["Kit reconhecimento", "Kit especial da campanha do mês", 180],
      ["Curso online", "Voucher de capacitação", 320]
    ].map(([name, description, cost]) =>
      prisma.reward.create({
        data: {
          name: String(name),
          description: String(description),
          cost: Number(cost),
          stock: 20
        }
      })
    )
  );
  await prisma.rewardRedemption.create({
    data: {
      employeeId: firstEmployee.id,
      rewardId: rewards[0].id,
      status: "SOLICITADO"
    }
  });

  const room = await prisma.chatRoom.create({
    data: {
      name: "Equipe Alfa",
      type: "TIME"
    }
  });
  await prisma.chatParticipant.createMany({
    data: [users["colaborador@central.com"], users["supervisor@central.com"], users["wfm@central.com"]].map((user) => ({
      roomId: room.id,
      userId: user.id
    }))
  });
  await prisma.chatMessage.createMany({
    data: [
      {
        roomId: room.id,
        senderId: users["supervisor@central.com"].id,
        content: "Bom dia, equipe. Atenção aos comunicados do turno."
      },
      {
        roomId: room.id,
        senderId: users["colaborador@central.com"].id,
        content: "Confirmado, estou acompanhando os chamados prioritários."
      }
    ]
  });

  await prisma.scheduleImport.create({
    data: {
      fileName: "Escala_Maio_2026_v3.xlsx",
      importedById: users["admin@central.com"].id,
      status: "Sucesso",
      totalRows: 248,
      validRows: 241,
      errorRows: 7,
      warnings: [{ message: "7 alertas de cobertura abaixo do mínimo" }]
    }
  });

  await prisma.systemConfig.createMany({
    data: [
      {
        key: "coverage.minimumPercent",
        value: 95,
        description: "Meta mínima de cobertura operacional"
      },
      {
        key: "tokens.presenceDaily",
        value: 5,
        description: "Tokens por presença diária"
      },
      {
        key: "requests.partialImportAllowed",
        value: true,
        description: "Permite importação parcial após confirmação"
      }
    ]
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actorId: users["admin@central.com"].id,
        action: "IMPORTACAO",
        entity: "ScheduleImport",
        entityId: "Escala_Maio_2026_v3.xlsx",
        after: { totalRows: 248, validRows: 241 },
        reason: "Seed inicial"
      },
      {
        actorId: users["supervisor@central.com"].id,
        action: "APROVACAO",
        entity: "Request",
        entityId: "REQ-1024",
        after: { status: "APROVADO" },
        reason: "Cobertura validada"
      },
      {
        actorId: users["ti@central.com"].id,
        action: "ALTERACAO_EQUIPAMENTO",
        entity: "Equipment",
        entityId: "EQP-0004",
        after: { status: "INOPERANTE" },
        reason: "Falha reportada"
      }
    ]
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed concluído. Usuários demo criados com senha Central@123.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
