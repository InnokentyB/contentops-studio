"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt = __importStar(require("bcrypt"));
const jwt = __importStar(require("jsonwebtoken"));
const dotenv_1 = require("dotenv");
const db_1 = __importDefault(require("../db"));
(0, dotenv_1.config)();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = '7d';
class AuthService {
    async register(email, password, name) {
        const existing = await db_1.default.user.findUnique({ where: { email } });
        if (existing) {
            throw new Error('User already exists');
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const finalName = name || email.split('@')[0];
        const timestamp = Date.now();
        const { user } = await db_1.default.$transaction(async (tx) => {
            const createdUser = await tx.user.create({ data: { email, name: finalName, password_hash: passwordHash } });
            const organization = await tx.organization.create({
                data: {
                    name: `${finalName}'s organization`,
                    slug: `personal-user-${createdUser.id}`,
                    members: { create: { user_id: createdUser.id, role: 'owner' } },
                    research_connections: { create: [
                            { source_type: 'reddit', name: 'Reddit', capabilities: ['search', 'read'] },
                            { source_type: 'indie_hackers', name: 'Indie Hackers', capabilities: ['search', 'read'] }
                        ] }
                }
            });
            await tx.project.create({ data: {
                    name: `${finalName}'s Project`,
                    slug: `${finalName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-project-${timestamp}`,
                    organization_id: organization.id,
                    members: {
                        create: {
                            user_id: createdUser.id,
                            role: 'owner'
                        }
                    },
                    // Create default settings
                    settings: {
                        createMany: {
                            data: [
                                { key: 'post_creator_prompt', value: 'You are a helpful assistant.' },
                                { key: 'post_creator_model', value: 'gpt-4' }
                            ]
                        }
                    },
                    research_profile: { create: { revision: 1 } }
                } });
            return { user: createdUser };
        });
        const token = this.generateToken(user);
        // Fetch the project again to match the expected format or just construct it
        // But getUserProjects returns what we need
        const projects = await this.getUserProjects(user.id);
        return { user: this.sanitizeUser(user), token, projects };
    }
    async login(email, password) {
        const user = await db_1.default.user.findUnique({ where: { email } });
        if (!user) {
            throw new Error('Invalid email or password');
        }
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            throw new Error('Invalid email or password');
        }
        const token = this.generateToken(user);
        const projects = await this.getUserProjects(user.id);
        return { user: this.sanitizeUser(user), token, projects };
    }
    generateToken(user) {
        return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    }
    verifyToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        }
        catch (e) {
            throw new Error('Invalid token');
        }
    }
    sanitizeUser(user) {
        const { password_hash, ...sanitized } = user;
        return sanitized;
    }
    async getUserProjects(userId) {
        const memberships = await db_1.default.projectMember.findMany({
            where: { user_id: userId },
            include: {
                project: {
                    include: {
                        _count: {
                            select: {
                                channels: true,
                                content_items: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                project: {
                    updated_at: 'desc'
                }
            }
        });
        return memberships.map(m => ({
            ...m.project,
            role: m.role,
            channels_count: m.project._count.channels,
            content_items_count: m.project._count.content_items
        }));
    }
    async hasProjectAccess(userId, projectId, minRole = 'viewer') {
        const membership = await db_1.default.projectMember.findUnique({
            where: {
                project_id_user_id: {
                    project_id: projectId,
                    user_id: userId
                }
            }
        });
        if (!membership)
            return false;
        const roles = ['viewer', 'editor', 'owner'];
        return roles.indexOf(membership.role) >= roles.indexOf(minRole);
    }
}
exports.default = new AuthService();
