const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false,
    },
    role: {
      type: String,
      enum: ["business", "creator", "admin", "finance_admin", "support", "super_admin"],
      default: "business",
    },
    avatar: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// 12 rounds in every real environment. The end-to-end harness (NODE_ENV=test) lowers it so
// hundreds of test sign-ups don't spend most of the suite hashing passwords.
function saltRounds() {
  const testRounds = Number(process.env.TEST_BCRYPT_ROUNDS);
  return process.env.NODE_ENV === "test" && Number.isInteger(testRounds) && testRounds >= 4 ? testRounds : 12;
}

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(saltRounds());
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
