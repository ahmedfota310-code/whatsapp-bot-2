const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const PHONE_NUMBER = '201119815696';
const BOT_SIGNATURE = 'Ahmed Abdelbaset';
const MAX_WARNINGS = 5;

const client = new Client({
    authStrategy: new LocalAuth(),
    pairWithPhoneNumber: {
        phoneNumber: PHONE_NUMBER,
        showNotification: true
    },
    puppeteer: {
        headless: true,
        protocolTimeout: 120000,
        timeout: 0,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote'
        ]
    }
});

client.on('code', (code) => {
    console.log('PAIRING CODE:', code);
});

client.on('ready', () => {
    console.log('Bot is ready!');
});

let isBotClosed = false;
let privateMode = false;
let antiGroupLink = true;
const allowedUsers = new Set();
const mutedUsers = new Set();
const linkWarnings = new Map();

const badWords = [
    'كسمك',
    'يبن الاحبه',
    'يبن مرا متناكه',
    'يبن شرموطه',
    'يبن عرص'
];

const TOP_BAR = '┏━━━━━━━━━━━━━━━━━━━━┓';
const MID_BAR = '┣━━━━━━━━━━━━━━━━━━━━┫';
const BOT_BAR = '┗━━━━━━━━━━━━━━━━━━━━┛';

function cardBox(icon, title, rows = [], footerNote = '') {
    const body = rows.map((r) => `│ ${r}`).join('\n');
    const extra = footerNote ? `\n│ ${footerNote}` : '';
    return `${TOP_BAR}\n│ ${icon} *${title}*\n${MID_BAR}\n${body}${extra}\n${BOT_BAR}\n╰─▸ *${BOT_SIGNATURE}*`;
}

function numberToArabicWord(num) {
    const map = {
        5: 'خمس',
        4: 'أربع',
        3: 'تلات',
        2: 'اتنين',
        1: 'واحد'
    };
    return map[num] || String(num);
}

function getUserLabel(contact, fallbackId = '') {
    if (contact) {
        return contact.pushname || contact.name || contact.id.user || fallbackId.replace('@c.us', '');
    }
    return fallbackId.replace('@c.us', '');
}

function normalizeToSerialized(input) {
    if (!input) return null;
    if (input.endsWith('@c.us') || input.endsWith('@g.us')) return input;
    const digits = String(input).replace(/\D/g, '');
    if (!digits) return null;
    return `${digits}@c.us`;
}

async function isBotGroupAdmin(chat) {
    if (!chat.isGroup) return false;
    const botId = client.info.wid._serialized;
    const botParticipant = (chat.participants || []).find((p) => p.id._serialized === botId);
    return Boolean(botParticipant && (botParticipant.isAdmin || botParticipant.isSuperAdmin));
}

async function getTargetUserId(msg, argsText = '') {
    if (msg.mentionedIds && msg.mentionedIds.length > 0) {
        return msg.mentionedIds[0];
    }
    if (msg.hasQuotedMsg) {
        const quoted = await msg.getQuotedMessage();
        return quoted.author || quoted.from;
    }
    const clean = argsText.replace(/@/g, '').trim();
    return normalizeToSerialized(clean);
}

async function handleCommand(msg) {
    const text = (msg.body || '').trim();
    const chat = await msg.getChat();
    const senderId = msg.author || msg.from;
    const isAuthorized = msg.fromMe || allowedUsers.has(senderId);

    if (chat.isGroup && !msg.fromMe && mutedUsers.has(senderId)) {
        const canDelete = await isBotGroupAdmin(chat);
        if (canDelete) {
            try {
                await msg.delete(true);
            } catch (_) {}
        }
        return;
    }

    if (
        chat.isGroup &&
        antiGroupLink &&
        !msg.fromMe &&
        /https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(text)
    ) {
        const canDelete = await isBotGroupAdmin(chat);
        if (canDelete) {
            try {
                await msg.delete(true);
            } catch (_) {}

            const key = `${chat.id._serialized}:${senderId}`;
            const currentWarns = (linkWarnings.get(key) || 0) + 1;
            const remaining = MAX_WARNINGS - currentWarns;

            let contact = null;
            try {
                contact = await client.getContactById(senderId);
            } catch (_) {}
            const tag = '@' + senderId.replace('@c.us', '');

            if (remaining > 0) {
                linkWarnings.set(key, currentWarns);
                const wordCount = numberToArabicWord(remaining);
                const warnLabel = remaining === 1 ? 'إنذار واحد' : `${wordCount} إنذارات`;

                await chat.sendMessage(
                    cardBox('⚠️', 'مخالفة نشر لينكات', [
                        `العضو : ${tag}`,
                        `السبب : نشر رابط جروب`,
                        `الحالة : فاضلك ${warnLabel}`
                    ]),
                    contact ? { mentions: [contact] } : {}
                );
            } else {
                linkWarnings.delete(key);
                try {
                    await chat.removeParticipants([senderId]);
                    await chat.sendMessage(
                        cardBox('🚨', 'تم الطرد لتجاوز الإنذارات', [
                            `العضو : ${tag}`,
                            `السبب : استنفاد جميع الإنذارات (${MAX_WARNINGS})`
                        ]),
                        contact ? { mentions: [contact] } : {}
                    );
                } catch (_) {
                    await chat.sendMessage(
                        cardBox('⚠️', 'تنبيه الإنذارات', [
                            `العضو : ${tag}`,
                            'الحالة : خلصت إنذاراتك (تعذر الطرد تلقائياً)'
                        ]),
                        contact ? { mentions: [contact] } : {}
                    );
                }
            }
        }
        return;
    }

    if (msg.fromMe && text === '.قفل') {
        isBotClosed = true;
        await msg.reply(cardBox('🔒', 'حالة البوت', ['الوضع : مقفول تماماً']));
        return;
    }

    if (msg.fromMe && text === '.فتح') {
        isBotClosed = false;
        await msg.reply(cardBox('🔓', 'حالة البوت', ['الوضع : مفتوح وجاهز']));
        return;
    }

    if (msg.fromMe && text === '.اسكت1') {
        antiGroupLink = false;
        await msg.reply(cardBox('🔇', 'حماية اللينكات', ['الحالة : تم الإيقاف']));
        return;
    }

    if (msg.fromMe && text === '.حمص') {
        await msg.reply('بومه');
        return;
    }

    if (msg.fromMe && text === '.كسمك') {
        await msg.reply('شكرا');
        return;
    }

    if (msg.fromMe && text.startsWith('.استخدام')) {
        const arg = text.replace('.استخدام', '').trim();
        const targetId = await getTargetUserId(msg, arg);
        if (!targetId) {
            await msg.reply(
                cardBox('ℹ️', 'طريقة الاستخدام', [
                    'منشن أو رد على الشخص واكتب .استخدام',
                    'أو اكتب : .استخدام 201xxxxxxxxx'
                ])
            );
            return;
        }
        allowedUsers.add(targetId);
        let label = targetId.replace('@c.us', '');
        try {
            const contact = await client.getContactById(targetId);
            label = getUserLabel(contact, targetId);
        } catch (_) {}

        await msg.reply(
            cardBox('✅', 'منح صلاحية الاستخدام', [
                `المستخدم : ~ ${label}`,
                'الحالة : مسموح له باستخدام البوت'
            ])
        );
        return;
    }

    if (msg.fromMe && text.startsWith('.عدم استخدام')) {
        const arg = text.replace('.عدم استخدام', '').trim();
        const targetId = await getTargetUserId(msg, arg);
        if (!targetId) {
            await msg.reply(
                cardBox('ℹ️', 'طريقة إلغاء الاستخدام', [
                    'منشن أو رد على الشخص واكتب .عدم استخدام',
                    'أو اكتب : .عدم استخدام 201xxxxxxxxx'
                ])
            );
            return;
        }
        allowedUsers.delete(targetId);
        let label = targetId.replace('@c.us', '');
        try {
            const contact = await client.getContactById(targetId);
            label = getUserLabel(contact, targetId);
        } catch (_) {}

        await msg.reply(
            cardBox('❌', 'سحب صلاحية الاستخدام', [
                `المستخدم : ~ ${label}`,
                'الحالة : تم إلغاء الصلاحية'
            ])
        );
        return;
    }

    if (isBotClosed) return;

    if (msg.fromMe && text === '.خاص') {
        privateMode = true;
        await msg.reply(cardBox('🛡️', 'وضع التشغيل', ['الوضع : خاص']));
        return;
    }

    if (msg.fromMe && text === '.جماعي') {
        privateMode = false;
        await msg.reply(cardBox('🌐', 'وضع التشغيل', ['الوضع : جماعي للجميع']));
        return;
    }

    if (privateMode && !isAuthorized) {
        return;
    }

    if (!msg.fromMe && text === '.بوت') {
        await msg.reply('كسمك');
        return;
    }

    if (!msg.fromMe && badWords.some((word) => text.includes(word))) {
        await msg.reply('كسمك');
        return;
    }

    if (text === 'اوامر' || text === '.اوامر') {
        await msg.reply(
            cardBox('📜', 'قائمة أوامر البوت', [
                '✦ ترفيه : نكتة | حظي | ملك او كتابة',
                '✦ ألعاب : .محكمة | .جوزني',
                '✦ إشراف : .طرد | .رفع | .كتم | .فك_الكتم',
                '✦ أدوات : .استرداد | .بوت',
                '✦ تحكم : .استخدام | .عدم استخدام',
                '✦ نظام : .اسكت1 | .قفل | .فتح | .خاص | .جماعي'
            ])
        );
    } else if (text === 'نكتة') {
        const jokes = [
            'مرة واحد كسلان راح الامتحان، سلم الورقة فاضية وكتب: الوقت لا يكفي.',
            'مرة مهندس اشترى عربية، كل ما تقف ينزل يخبط الكبوت ويقول: شغال اهو.',
            'مرة طالب بيقول للمدرس: يا أستاذ هو الواحد ممكن يتعاقب على حاجة معملهاش؟ قاله: لأ طبعاً. قاله: طب أنا معملتش الواجب.'
        ];
        await msg.reply(
            cardBox('😂', 'نكتة اليوم', [
                jokes[Math.floor(Math.random() * jokes.length)]
            ])
        );
    } else if (text === 'حظي') {
        const luck = [
            'حظك النهاردة حلو جداً، خبر كويس في الطريق.',
            'حظك متوسط، خد الأمور بهدوء وبلاش تسرع.',
            'حظك محتاج صبر شوية النهاردة، وبكرة أحلى.'
        ];
        await msg.reply(
            cardBox('🍀', 'توقعات الحظ', [
                luck[Math.floor(Math.random() * luck.length)]
            ])
        );
    } else if (text === 'ملك او كتابة') {
        const coin = Math.random() < 0.5 ? 'ملك' : 'كتابة';
        await msg.reply(
            cardBox('🪙', 'رمية العملة', [
                `النتيجة : *${coin}*`
            ])
        );
    } else if (text === '.محكمة') {
        if (!chat.isGroup) {
            await msg.reply(cardBox('⚖️', 'تنبيه', ['لعبة المحكمة متاحة داخل الجروبات فقط']));
            return;
        }
        const participants = chat.participants || [];
        if (participants.length === 0) return;

        const accused = participants[Math.floor(Math.random() * participants.length)];
        const contact = await client.getContactById(accused.id._serialized);
        const tag = '@' + accused.id.user;

        const charges = [
            'اختفاء البطارية وقت الجد',
            'تأخير الرد على الرسايل 3 أيام',
            'نشر نكت بايخة في الجروب',
            'أكل آخر حتة في الصينية بدون استئذان'
        ];
        const verdicts = [
            'حكمت المحكمة حضورياً بالبراءة لعدم كفاية الأدلة.',
            'حكمت المحكمة بغرامة 50 جنيه تدفع في أقرب قعدة.',
            'حكمت المحكمة بالأشغال الشاقة: يكتب نكتة حلوة دلوقتي.',
            'حكمت المحكمة بالحبس الاحتياطي في الجروب لمدة 10 دقايق.'
        ];

        const charge = charges[Math.floor(Math.random() * charges.length)];
        const verdict = verdicts[Math.floor(Math.random() * verdicts.length)];

        await chat.sendMessage(
            cardBox('⚖️', 'جلسة محكمة الجروب', [
                `المتهم : ${tag}`,
                `التهمة : ${charge}`,
                `الحكم : ${verdict}`
            ]),
            { mentions: [contact] }
        );
    } else if (text.startsWith('.استرداد')) {
        const arg = text.replace('.استرداد', '').trim();
        const targetId = await getTargetUserId(msg, arg);
        if (!targetId) {
            await msg.reply(cardBox('🖼️', 'تنبيه', ['منشن أو رد على رسالة الشخص واكتب .استرداد']));
            return;
        }
        try {
            const picUrl = await client.getProfilePicUrl(targetId);
            if (!picUrl) {
                await msg.reply(cardBox('🖼️', 'تعذر الجلب', ['الشخص ده قافل البروفايل أو مش حاطط صورة']));
                return;
            }
            const media = await MessageMedia.fromUrl(picUrl);
            let label = targetId.replace('@c.us', '');
            try {
                const contact = await client.getContactById(targetId);
                label = getUserLabel(contact, targetId);
            } catch (_) {}

            await msg.reply(media, undefined, {
                caption: cardBox('🖼️', 'صورة البروفايل', [
                    `المستخدم : ~ ${label}`
                ])
            });
        } catch (_) {
            await msg.reply(cardBox('⚠️', 'خطأ', ['مقدرتش أجيب صورة البروفايل']));
        }
    } else if (text.startsWith('.رفع')) {
        if (!isAuthorized) {
            await msg.reply(cardBox('⛔', 'صلاحيات', ['الأمر ده للمالك أو الأشخاص المسموح لهم بس']));
            return;
        }
        if (!chat.isGroup) {
            await msg.reply(cardBox('👑', 'تنبيه', ['الأمر ده بيشتغل جوه الجروبات بس']));
            return;
        }
        const canPromote = await isBotGroupAdmin(chat);
        if (!canPromote) {
            await msg.reply(cardBox('⚠️', 'تنبيه الإشراف', ['ارفع البوت مشرف في الجروب الأول عشان يقدر يرفع غيره']));
            return;
        }
        const arg = text.replace('.رفع', '').trim();
        const targetId = await getTargetUserId(msg, arg);
        if (!targetId) {
            await msg.reply(cardBox('👑', 'تنبيه', ['منشن الشخص أو رد على رسالته واكتب .رفع']));
            return;
        }
        try {
            await chat.promoteParticipants([targetId]);
            const contact = await client.getContactById(targetId);
            const label = getUserLabel(contact, targetId);
            await chat.sendMessage(
                cardBox('👑', 'ترقية عضو', [
                    `العضو : @${contact.id.user} ~ ${label}`,
                    'الصلاحية : مشرف المجموعة'
                ]),
                { mentions: [contact] }
            );
        } catch (_) {
            await msg.reply(cardBox('⚠️', 'تعذر الترقية', ['مقدرتش أرفعه مشرف']));
        }
    } else if (text.startsWith('.كتم') && !text.startsWith('.فك_الكتم')) {
        if (!isAuthorized) {
            await msg.reply(cardBox('⛔', 'صلاحيات', ['الأمر ده للمالك أو الأشخاص المسموح لهم بس']));
            return;
        }
        if (!chat.isGroup) {
            await msg.reply(cardBox('🤐', 'تنبيه', ['الأمر ده بيشتغل جوه الجروبات بس']));
            return;
        }
        const canMute = await isBotGroupAdmin(chat);
        if (!canMute) {
            await msg.reply(cardBox('⚠️', 'تنبيه الإشراف', ['ارفع البوت مشرف في الجروب الأول عشان يقدر يكتم']));
            return;
        }
        const arg = text.replace('.كتم', '').trim();
        const targetId = await getTargetUserId(msg, arg);
        if (!targetId) {
            await msg.reply(cardBox('🤐', 'تنبيه', ['منشن الشخص أو رد على رسالته واكتب .كتم']));
            return;
        }
        mutedUsers.add(targetId);
        const contact = await client.getContactById(targetId);
        const label = getUserLabel(contact, targetId);
        await chat.sendMessage(
            cardBox('🤐', 'تم كتم العضو', [
                `العضو : @${contact.id.user} ~ ${label}`,
                'الحالة : مكتوم (سيتم حذف رسائله)'
            ]),
            { mentions: [contact] }
        );
    } else if (text.startsWith('.فك_الكتم')) {
        if (!isAuthorized) {
            await msg.reply(cardBox('⛔', 'صلاحيات', ['الأمر ده للمالك أو الأشخاص المسموح لهم بس']));
            return;
        }
        const arg = text.replace('.فك_الكتم', '').trim();
        const targetId = await getTargetUserId(msg, arg);
        if (!targetId) {
            await msg.reply(cardBox('🔊', 'تنبيه', ['منشن الشخص أو رد على رسالته واكتب .فك_الكتم']));
            return;
        }
        mutedUsers.delete(targetId);
        const contact = await client.getContactById(targetId);
        const label = getUserLabel(contact, targetId);
        await chat.sendMessage(
            cardBox('🔊', 'تم فك الكتم', [
                `العضو : @${contact.id.user} ~ ${label}`,
                'الحالة : مسموح له بالتحدث'
            ]),
            { mentions: [contact] }
        );
    } else if (text === '.جوزني') {
        if (!chat.isGroup) {
            await msg.reply(cardBox('💍', 'تنبيه', ['الأمر ده بيشتغل جوه الجروبات بس']));
            return;
        }
        const candidates = (chat.participants || []).filter((p) => p.id._serialized !== senderId);
        if (candidates.length === 0) {
            await msg.reply(cardBox('💍', 'تنبيه', ['مفيش حد تاني في الجروب أختاره']));
            return;
        }
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        const contact = await client.getContactById(chosen.id._serialized);
        const label = getUserLabel(contact, chosen.id._serialized);
        await chat.sendMessage(
            cardBox('💍', 'مبروك معرصين', [
                `الشريك : @${chosen.id.user} ~ ${label}`
            ]),
            { mentions: [contact] }
        );
    } else if (text.startsWith('.طرد')) {
        if (!isAuthorized) {
            await msg.reply(cardBox('⛔', 'صلاحيات', ['الأمر ده للمالك أو الأشخاص المسموح لهم بس']));
            return;
        }
        if (!chat.isGroup) {
            await msg.reply(cardBox('🚪', 'تنبيه', ['الأمر ده بيشتغل جوه الجروبات بس']));
            return;
        }
        const canKick = await isBotGroupAdmin(chat);
        if (!canKick) {
            await msg.reply(cardBox('⚠️', 'تنبيه الإشراف', ['ارفع البوت مشرف في الجروب الأول عشان يقدر يطرد']));
            return;
        }
        const targets = msg.mentionedIds || [];
        if (targets.length === 0) {
            await msg.reply(cardBox('🚪', 'تنبيه', ['منشن الشخص اللي عايز تطرده مع كلمة .طرد']));
            return;
        }
        try {
            await chat.removeParticipants(targets);
            await msg.reply(
                cardBox('🚪', 'تم الطرد بنجاح', [
                    `العدد : ${targets.length}`,
                    'الحالة : تم إخراج العضو من المجموعة'
                ])
            );
        } catch (_) {
            await msg.reply(cardBox('⚠️', 'تعذر الطرد', ['مقدرتش أطرده (ممكن يكون مشرف أو في مشكلة صلاحيات)']));
        }
    }
}

client.on('message', async (msg) => {
    await handleCommand(msg);
});

client.on('message_create', async (msg) => {
    if (msg.fromMe) {
        await handleCommand(msg);
    }
});

client.initialize();
