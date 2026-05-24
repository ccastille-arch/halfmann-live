import bcrypt from 'bcryptjs'

const password = process.argv[2] || process.env.ADMIN_PASSWORD_PLAINTEXT || ''

if (!password) {
  console.error('Usage: node scripts/hash-password.js "<password>"')
  process.exit(1)
}

const rounds = 12
const hash = await bcrypt.hash(password, rounds)
console.log(hash)
