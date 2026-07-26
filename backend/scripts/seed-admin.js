const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const email = process.env.ADMIN_EMAIL || "admin@dentalux.mx";
const pass  = process.env.ADMIN_PASS  || "cambia_esto_ya";

(async () => {
  try {
    const passwordHash = await bcrypt.hash(pass, 12);
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role: "ADMIN", isActive: true, name: "Administrador" },
      create: { email, passwordHash, role: "ADMIN", isActive: true, name: "Administrador" }
    });
    console.log("✅ Admin listo:", user.email);
    process.exit(0);
  } catch (e) {
    console.error("❌ Error seed admin:", e);
    process.exit(1);
  }
})();
