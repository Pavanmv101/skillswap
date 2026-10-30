const mongoose = require('mongoose');

const certificateFileSchema = new mongoose.Schema(
  {
    verification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SkillVerification',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    fileId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    originalName: {
      type: String,
      default: 'certificate',
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    data: {
      type: Buffer,
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CertificateFile', certificateFileSchema);
