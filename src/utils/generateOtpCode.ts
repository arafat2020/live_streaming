import * as bcrypt from 'bcrypt';

export function generateOtpCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export async function hashOtpCode(code: string) {
  return bcrypt.hash(code, parseInt(process.env.SALT_ROUND!));
}
