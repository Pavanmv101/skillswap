const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const SkillVerification = require('../models/SkillVerification');
const CertificateFile = require('../models/CertificateFile');
const User = require('../models/User');
const { createAndEmitNotification } = require('../services/notificationService');

const CERTIFICATES_DIR = path.join(__dirname, '..', 'uploads', 'certificates');

// Ensure private upload directory exists
if (!fs.existsSync(CERTIFICATES_DIR)) {
  fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
}

// Allowed file types by magic byte signatures
function detectMimeType(buffer) {
  if (buffer.length < 4) return null;
  // PDF: %PDF (0x25, 0x50, 0x44, 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  // PNG: 0x89 0x50 0x4E 0x47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: 0xFF 0xD8 0xFF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  return null;
}

// POST /api/verification
exports.submitVerification = async (req, res) => {
  try {
    const {
      skillName,
      category,
      evidenceType,
      evidenceUrl,
      certificateBase64,
      certificateFileName,
      description,
    } = req.body;

    if (!skillName || !skillName.trim()) {
      return res.status(400).json({ message: 'Skill name is required' });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ message: 'Project or experience description is required' });
    }

    if (!['certificate', 'github', 'portfolio', 'project'].includes(evidenceType)) {
      return res.status(400).json({ message: 'Invalid evidence type' });
    }

    // Verify the student actually offers this skill
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const offeredSkill = (user.skillsOffered || []).find(
      s => s.skill.toLowerCase() === skillName.trim().toLowerCase()
    );

    if (!offeredSkill) {
      return res.status(400).json({
        message: `You must add "${skillName}" to your offered skills before requesting verification`,
      });
    }

    let validatedUrl = '';
    let savedFilePath = '';
    let originalName = '';
    let detectedMime = '';
    let fileBuffer = null;

    // Validate URL evidence
    if (['github', 'portfolio', 'project'].includes(evidenceType)) {
      if (!evidenceUrl || !evidenceUrl.trim()) {
        return res.status(400).json({ message: `A valid URL is required for ${evidenceType} evidence` });
      }

      try {
        const parsedUrl = new URL(evidenceUrl.trim());
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return res.status(400).json({ message: 'URL must begin with http:// or https://' });
        }
        validatedUrl = parsedUrl.toString();
      } catch (err) {
        return res.status(400).json({ message: 'Invalid URL format' });
      }
    }

    // Handle Certificate File Upload (base64)
    if (evidenceType === 'certificate') {
      if (!certificateBase64) {
        return res.status(400).json({ message: 'Certificate file data is required' });
      }

      // Strip data URI prefix if present (e.g. data:application/pdf;base64,...)
      const base64Data = certificateBase64.replace(/^data:[^;]+;base64,/, '');
      fileBuffer = Buffer.from(base64Data, 'base64');

      // Max size: 5 MB
      const MAX_SIZE = 5 * 1024 * 1024;
      if (fileBuffer.length > MAX_SIZE) {
        return res.status(400).json({ message: 'File size exceeds maximum limit of 5MB' });
      }

      // Detect MIME type by inspecting raw file magic bytes
      detectedMime = detectMimeType(fileBuffer);
      if (!detectedMime) {
        return res.status(400).json({
          message: 'Unsupported or unverified file type. Only authentic PDF, PNG, and JPEG documents are permitted.',
        });
      }

      // Extension mapping based on verified MIME
      const ext = detectedMime === 'application/pdf' ? 'pdf' : detectedMime === 'image/png' ? 'png' : 'jpg';
      const fileId = `${crypto.randomUUID()}.${ext}`;

      // Save to local cache directory if available
      try {
        const destination = path.join(CERTIFICATES_DIR, fileId);
        await fs.promises.writeFile(destination, fileBuffer);
      } catch (fsErr) {
        console.warn('[Storage] Local disk write fallback note:', fsErr.message);
      }

      savedFilePath = fileId;
      originalName = (certificateFileName || `certificate.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    // Check for existing verification submission for this user and skill
    const existing = await SkillVerification.findOne({
      user: req.userId,
      skillName: offeredSkill.skill,
    });

    if (existing) {
      if (existing.status === 'verified') {
        return res.status(400).json({ message: 'This skill has already been verified' });
      }
      if (existing.status === 'pending') {
        return res.status(400).json({ message: 'A verification submission for this skill is already pending review' });
      }

      // If previously rejected, allow resubmission by updating the record
      existing.evidenceType = evidenceType;
      existing.evidenceUrl = validatedUrl;
      existing.certificateFile = savedFilePath || existing.certificateFile;
      existing.certificateOriginalName = originalName || existing.certificateOriginalName;
      existing.certificateMimeType = detectedMime || existing.certificateMimeType;
      existing.description = description.trim();
      existing.category = category || offeredSkill.category || 'General';
      existing.status = 'pending';
      existing.rejectionReason = '';
      existing.reviewedBy = null;
      existing.reviewedAt = null;

      await existing.save();

      // Persist certificate file data in dedicated collection for 100% cloud durability
      if (savedFilePath && fileBuffer) {
        await CertificateFile.findOneAndUpdate(
          { verification: existing._id },
          {
            verification: existing._id,
            user: req.userId,
            fileId: savedFilePath,
            originalName,
            mimeType: detectedMime,
            size: fileBuffer.length,
            data: fileBuffer,
          },
          { upsert: true, new: true }
        );
      }

      // Trigger Notification
      await createAndEmitNotification({
        recipient: req.userId,
        type: 'VERIFICATION_SUBMITTED',
        title: 'Skill Verification Resubmitted 📋',
        message: `Your updated evidence for "${offeredSkill.skill}" has been submitted for administrator review.`,
      });

      return res.status(200).json(existing);
    }

    // Create fresh verification submission
    const verification = new SkillVerification({
      user: req.userId,
      skillName: offeredSkill.skill,
      category: category || offeredSkill.category || 'General',
      evidenceType,
      evidenceUrl: validatedUrl,
      certificateFile: savedFilePath,
      certificateOriginalName: originalName,
      certificateMimeType: detectedMime,
      description: description.trim(),
      status: 'pending',
    });

    await verification.save();

    // Persist certificate file data in dedicated collection for 100% cloud durability
    if (savedFilePath && fileBuffer) {
      await CertificateFile.create({
        verification: verification._id,
        user: req.userId,
        fileId: savedFilePath,
        originalName,
        mimeType: detectedMime,
        size: fileBuffer.length,
        data: fileBuffer,
      });
    }

    // Trigger Notification
    await createAndEmitNotification({
      recipient: req.userId,
      type: 'VERIFICATION_SUBMITTED',
      title: 'Skill Verification Submitted 📋',
      message: `Your evidence for "${offeredSkill.skill}" has been submitted for administrator review.`,
    });

    res.status(201).json(verification);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/verification/my
exports.getMyVerifications = async (req, res) => {
  try {
    const list = await SkillVerification.find({ user: req.userId })
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/verification/:id
exports.getVerificationById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid verification ID' });
    }

    const verification = await SkillVerification.findById(req.params.id)
      .populate('user', 'name email skillsOffered')
      .populate('reviewedBy', 'name email');

    if (!verification) {
      return res.status(404).json({ message: 'Verification record not found' });
    }

    // Authorization: owner or admin only
    const user = await User.findById(req.userId).select('role');
    const isAdmin = user && user.role === 'admin';
    const isOwner = verification.user._id.toString() === req.userId.toString();

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized to view this verification record' });
    }

    res.status(200).json(verification);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/verification/:id/file
// Securely streams the private certificate document to authorized viewers only
exports.downloadCertificateFile = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid verification ID' });
    }

    const verification = await SkillVerification.findById(req.params.id);
    if (!verification || !verification.certificateFile) {
      return res.status(404).json({ message: 'Certificate document not found' });
    }

    // Authorization check
    const user = await User.findById(req.userId).select('role');
    const isAdmin = user && user.role === 'admin';
    const isOwner = verification.user.toString() === req.userId.toString();

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Access denied: You do not have permission to view this document' });
    }

    // 1. First check persistent cloud storage (MongoDB CertificateFile collection)
    const certDoc = await CertificateFile.findOne({
      $or: [
        { verification: verification._id },
        { fileId: verification.certificateFile },
      ],
    });

    if (certDoc && certDoc.data) {
      res.setHeader('Content-Type', certDoc.mimeType || verification.certificateMimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${certDoc.originalName || verification.certificateOriginalName || 'certificate'}"`
      );
      return res.send(certDoc.data);
    }

    // 2. Fallback to local filesystem cache if available
    const filePath = path.join(CERTIFICATES_DIR, path.basename(verification.certificateFile));

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Physical document file missing from storage' });
    }

    res.setHeader('Content-Type', verification.certificateMimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${verification.certificateOriginalName || 'certificate'}"`
    );

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
